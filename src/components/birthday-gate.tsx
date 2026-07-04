"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { format, isValid, parse } from "date-fns";
import { es } from "date-fns/locale";
import React, { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
// @ts-ignore
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { supabase } from "../lib/supabase";

const birthdaySchema = z
  .object({
    day: z.string().trim().min(1, "Día requerido").regex(/^\d{1,2}$/, "Día inválido"),
    month: z.string().trim().min(1, "Mes requerido").regex(/^\d{1,2}$/, "Mes inválido"),
    year: z.string().trim().min(4, "Año requerido").regex(/^\d{4}$/, "Año inválido"),
  })
  .superRefine(({ day, month, year }, ctx) => {
    const parsed = parse(`${year}-${month}-${day}`, "yyyy-M-d", new Date());

    if (!isValid(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["day"],
        message: "Fecha no válida",
      });
    }
  });

type BirthdayFormValues = z.infer<typeof birthdaySchema>;

// Borde de captura de errores para Canvas de Three.js
class CanvasErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("3D Canvas Error caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-black/5 text-red-500 font-mono text-[9px] p-2 text-center z-50 rounded-md">
          Error en carga 3D: {this.state.error?.message || String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

// Hook personalizado para cargar el modelo GLB de forma explícita sin Suspense
function useCustomGLTF(url: string) {
  const [model, setModel] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf: any) => {
        if (active) {
          setModel(gltf);
          setLoading(false);
          console.log("GLTF model loaded successfully:", url);
        }
      },
      undefined,
      (err: any) => {
        if (active) {
          setError(err);
          setLoading(false);
          console.error("GLTFLoader Error for " + url + ":", err);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [url]);

  return { model, error, loading };
}

// Componente para la flor interactiva 3D con escala ampliada y posición Y adaptada
function InteractiveFlowerModel({ model }: { model: any }) {
  const clone = useMemo(() => model.scene.clone(), [model]);
  return <primitive object={clone} position={[0, -2.0, 0]} scale={[4.2, 4.2, 4.2]} />;
}

// Componente para una flor individual en la lluvia 3D
function FlowerInstance({
  model,
  speed,
  initialPos,
  rotationSpeed,
  scale,
  waveSpeed,
  waveAmp,
}: {
  model: any;
  speed: number;
  initialPos: [number, number, number];
  rotationSpeed: [number, number, number];
  scale: number;
  waveSpeed: number;
  waveAmp: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const { viewport } = useThree();
  const time = useRef(Math.random() * 100);

  useEffect(() => {
    if (ref.current) {
      ref.current.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
    }
  }, []);

  useFrame((state, delta) => {
    if (!ref.current) return;
    time.current += delta;

    let nextY = ref.current.position.y - speed * delta;

    const boundaryY = viewport.height / 2 + 2;
    if (nextY < -boundaryY) {
      nextY = boundaryY;
      ref.current.position.x = (Math.random() - 0.5) * viewport.width;
      ref.current.position.z = (Math.random() - 0.5) * 4 - 2;
    }

    const nextX = ref.current.position.x + Math.sin(time.current * waveSpeed) * waveAmp * delta;

    ref.current.position.y = nextY;
    ref.current.position.x = nextX;

    ref.current.rotation.x += rotationSpeed[0] * delta;
    ref.current.rotation.y += rotationSpeed[1] * delta;
    ref.current.rotation.z += rotationSpeed[2] * delta;
  });

  const clone = useMemo(() => model.scene.clone(), [model]);

  return (
    <primitive
      ref={ref}
      object={clone}
      position={initialPos}
      scale={[scale, scale, scale]}
    />
  );
}

// Escena que distribuye las flores en la lluvia de fondo con escala corregida
function FlowersScene({ model }: { model: any }) {
  const { viewport } = useThree();

  const flowers = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => {
      const x = (Math.random() - 0.5) * 16;
      const y = Math.random() * 16 - 8;
      const z = (Math.random() - 0.5) * 4 - 2;

      const speed = Math.random() * 1.4 + 0.8;
      // Rango de escala 0.8 a 1.3 (corregido por tamaño real de geometría del modelo)
      const scale = Math.random() * 0.5 + 0.8;
      const rotationSpeed: [number, number, number] = [
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
      ];
      const waveSpeed = Math.random() * 1.5 + 0.5;
      const waveAmp = Math.random() * 0.4 + 0.15;

      return {
        id: i,
        initialPos: [x, y, z] as [number, number, number],
        speed,
        scale,
        rotationSpeed,
        waveSpeed,
        waveAmp,
      };
    });
  }, []);

  return (
    <>
      <ambientLight intensity={2.0} />
      <directionalLight position={[5, 10, 5]} intensity={3.0} />
      <pointLight position={[-5, -5, -5]} intensity={1.8} />
      {flowers.map((f) => (
        <FlowerInstance
          key={f.id}
          model={model}
          initialPos={f.initialPos}
          speed={f.speed}
          scale={f.scale}
          rotationSpeed={f.rotationSpeed}
          waveSpeed={f.waveSpeed}
          waveAmp={f.waveAmp}
        />
      ))}
    </>
  );
}

// Componente Canvas principal para la lluvia 3D de fondo con desvanecimiento inicial
function FallingFlowers({ hasMounted, model }: { hasMounted: boolean; model: any }) {
  if (!hasMounted || !model) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.6, duration: 2.2 }}
      className="fixed inset-0 z-40 pointer-events-none w-full h-full"
    >
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [0, 0, 8], fov: 60 }}
          gl={{ alpha: true, antialias: true }}
          style={{ background: "transparent" }}
        >
          <FlowersScene model={model} />
        </Canvas>
      </CanvasErrorBoundary>
    </motion.div>
  );
}

// Componente para el efecto de texto ofuscado/flicker premium
function GlitchText({ text, active }: { text: string; active: boolean }) {
  const [displayText, setDisplayText] = useState("");
  const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_+-*/=[]|";
  
  const getScrambled = (str: string) => {
    return str
      .split("")
      .map((char) => {
        if (char === " ") return " ";
        return glyphs[Math.floor(Math.random() * glyphs.length)];
      })
      .join("");
  };

  useEffect(() => {
    setDisplayText(getScrambled(text));
  }, [text]);

  useEffect(() => {
    if (!active) {
      setDisplayText(text);
      return;
    }

    const interval = setInterval(() => {
      setDisplayText(getScrambled(text));
    }, 90);

    return () => clearInterval(interval);
  }, [text, active]);

  return <span className="font-mono">{displayText}</span>;
}

// Componente para escribir texto con efecto glitch decrypt progresivo
function TypewriterText({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [displayedText, setDisplayedText] = useState("");
  const glyphs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_+-*/=[]|";
  
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    let index = 0;
    let currentText = "";
    
    const interval = setInterval(() => {
      if (index < text.length) {
        currentText = text.slice(0, index + 1);
        
        let glitchSuffix = "";
        if (index + 1 < text.length) {
          const remaining = Math.min(6, text.length - (index + 1));
          for (let i = 0; i < remaining; i++) {
            if (text[index + 1 + i] === " ") {
              glitchSuffix += " ";
            } else {
              glitchSuffix += glyphs[Math.floor(Math.random() * glyphs.length)];
            }
          }
        }
        
        setDisplayedText(currentText + glitchSuffix);
        index++;
      } else {
        clearInterval(interval);
        setDisplayedText(text);
        if (onCompleteRef.current) {
          onCompleteRef.current();
        }
      }
    }, 40);

    return () => clearInterval(interval);
  }, [text]);

  return <span>{displayedText}</span>;
}

// Animación de fondo: líneas que esquivan la zona central de la pantalla
function BackgroundAnimation() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let width = (canvas.width = window.innerWidth || 800);
    let height = (canvas.height = window.innerHeight || 600);

    if (width < 300) width = canvas.width = 800;
    if (height < 300) height = canvas.height = 600;

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth || 800;
      height = canvas.height = window.innerHeight || 600;
    };
    window.addEventListener("resize", handleResize);

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      speed: number;
      history: { x: number; y: number }[];
      maxHistory: number;
      life: number;
      maxLife: number;
      waveOffset: number;
    }

    let particles: Particle[] = [];
    const maxParticles = 14;

    const spawn = (): Particle => {
      const side = Math.floor(Math.random() * 4);
      let x = 0, y = 0, angle = 0;
      
      if (side === 0) { // Top
        x = Math.random() * width;
        y = -30;
        angle = Math.random() * Math.PI;
      } else if (side === 1) { // Bottom
        x = Math.random() * width;
        y = height + 30;
        angle = -Math.random() * Math.PI;
      } else if (side === 2) { // Left
        x = -30;
        y = Math.random() * height;
        angle = Math.random() * Math.PI - Math.PI / 2;
      } else { // Right
        x = width + 30;
        y = Math.random() * height;
        angle = Math.random() * Math.PI + Math.PI / 2;
      }

      const speed = Math.random() * 1.5 + 0.8;
      return {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        history: [],
        maxHistory: Math.floor(Math.random() * 26) + 16,
        life: 0,
        maxLife: Math.floor(Math.random() * 400) + 200,
        waveOffset: Math.random() * 100,
      };
    };

    for (let i = 0; i < maxParticles; i++) {
      particles.push(spawn());
      const p = particles[i];
      const ticks = Math.floor(Math.random() * 300);
      for (let t = 0; t < ticks; t++) {
        p.x += p.vx;
        p.y += p.vy;
        p.history.push({ x: p.x, y: p.y });
        if (p.history.length > p.maxHistory) {
          p.history.shift();
        }
      }
    }

    const loop = () => {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const exclusionRadius = Math.min(width, height) * 0.22 + 90;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life++;

        p.history.push({ x: p.x, y: p.y });
        if (p.history.length > p.maxHistory) {
          p.history.shift();
        }

        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < exclusionRadius && dist > 0.1) {
          const force = (exclusionRadius - dist) / exclusionRadius;
          const ux = dx / dist;
          const uy = dy / dist;

          p.vx += ux * force * 0.25;
          p.vy += uy * force * 0.25;

          const currentSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (currentSpeed > 0.1) {
            p.vx = (p.vx / currentSpeed) * p.speed;
            p.vy = (p.vy / currentSpeed) * p.speed;
          }
        }

        const wave = Math.sin((p.life + p.waveOffset) * 0.015) * 0.008;
        const angle = Math.atan2(p.vy, p.vx) + wave;
        p.vx = Math.cos(angle) * p.speed;
        p.vy = Math.sin(angle) * p.speed;

        p.x += p.vx;
        p.y += p.vy;

        const outOfBounds = p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60;
        if (p.life >= p.maxLife || outOfBounds) {
          particles[i] = spawn();
        }

        if (p.history.length > 1) {
          for (let j = 0; j < p.history.length - 1; j++) {
            const p1 = p.history[j];
            const p2 = p.history[j + 1];

            const ratio = j / (p.history.length - 1);
            const lifeFade = Math.min(1, (p.maxLife - p.life) / 40);
            
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            
            ctx.strokeStyle = `rgba(100, 110, 120, ${ratio * 0.22 * lifeFade})`;
            ctx.lineWidth = 1.4 * ratio;
            ctx.stroke();
          }
        }
      }

      animationId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-[1] pointer-events-none w-full h-full" />;
}

export function BirthdayGate() {
  const [hasMounted, setHasMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showSuccessIndicator, setShowSuccessIndicator] = useState(false);
  const [showErrorIndicator, setShowErrorIndicator] = useState(false);
  const [isEnvelopeDisappeared, setIsEnvelopeDisappeared] = useState(false);

  // Estados de control de la narrativa general
  const [narrativeStep, setNarrativeStep] = useState(-1);
  
  // Respuestas del usuario
  const [freeWeekend, setFreeWeekend] = useState<boolean | null>(null);
  const [freeDay, setFreeDay] = useState<"Sábado" | "Domingo" | null>(null);
  const [meetingTime, setMeetingTime] = useState<string>("");
  const [trustTaste, setTrustTaste] = useState<boolean | null>(null);
  const [favSushiPlace, setFavSushiPlace] = useState("");

  // Visibilidad de controles de opción en cada paso
  const [showQ1Options, setShowQ1Options] = useState(false);
  const [showQ2Options, setShowQ2Options] = useState(false);
  const [showQ3TimeInput, setShowQ3TimeInput] = useState(false);
  const [showQ4Options, setShowQ4Options] = useState(false);
  const [showSushiPlaceInput, setShowSushiPlaceInput] = useState(false);

  // Desplazamiento dinámico para el botón travieso "No" de la primera pregunta
  const [q1NoBtnOffset, setQ1NoBtnOffset] = useState({ x: 0, y: 0 });

  // Input de hora/minutos (HH:MM AM/PM) con desplegables
  const [hourVal, setHourVal] = useState("");
  const [minVal, setMinVal] = useState("");
  const [ampmVal, setAmpmVal] = useState<"AM" | "PM">("PM");
  const [timeError, setTimeError] = useState("");

  // Estados para modal de advertencia de horario
  const [showTimeWarningModal, setShowTimeWarningModal] = useState(false);
  const [timeWarningMessage, setTimeWarningMessage] = useState("");
  const [isTimeWarningStrict, setIsTimeWarningStrict] = useState(false);

  // Estados del mapa interactivo
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  // Estado para el flujo de letras que se desprenden del glitch central
  const [floatingLetters, setFloatingLetters] = useState<{ id: number; char: string; tx: string; ty: string }[]>([]);

  // Carga explícita del modelo GLB para usar en ambos elementos
  const { model, error: modelError, loading: modelLoading } = useCustomGLTF("/spider_lily_lycoris_radiata.glb");

  // Referencias para manejar el foco dinámico del cumpleaños
  const dayRef = useRef<HTMLInputElement | null>(null);
  const monthRef = useRef<HTMLInputElement | null>(null);
  const yearRef = useRef<HTMLInputElement | null>(null);

  // Referencias para Leaflet
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  // Ref para evitar inserciones duplicadas en Supabase
  const hasInsertedRef = useRef(false);
  
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BirthdayFormValues>({
    resolver: zodResolver(birthdaySchema),
    defaultValues: {
      day: "",
      month: "",
      year: "",
    },
  });

  // Efecto para hidratación cliente
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const onSubmit = async (values: BirthdayFormValues) => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    const dayNum = parseInt(values.day, 10);
    const monthNum = parseInt(values.month, 10);
    const yearNum = parseInt(values.year, 10);

    if (dayNum !== 16 || monthNum !== 6 || yearNum !== 2001) {
      setIsOpen(false);
      setTimeout(() => {
        setShowErrorIndicator(true);
        setTimeout(() => {
          setShowErrorIndicator(false);
        }, 2500);
      }, 850);
      return;
    }

    setIsOpen(false);
    setTimeout(() => {
      setShowSuccessIndicator(true);
      setTimeout(() => {
        setShowSuccessIndicator(false);
        setTimeout(() => {
          setIsEnvelopeDisappeared(true);
        }, 400);
      }, 3000);
    }, 850);
  };

  useEffect(() => {
    if (isEnvelopeDisappeared) {
      setNarrativeStep(0);
      
      const timer = setTimeout(() => {
        setNarrativeStep(1);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isEnvelopeDisappeared]);

  useEffect(() => {
    // Mostrar efecto de letras flotantes en todos los pasos narrativos activos previos al Paso 7 final
    if (narrativeStep < 0 || narrativeStep === 7) {
      setFloatingLetters([]);
      return;
    }

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_[]+*/=";
    const interval = setInterval(() => {
      const newLetter = {
        id: Math.random(),
        char: chars[Math.floor(Math.random() * chars.length)],
        // Dispersión radial hacia todas las direcciones de la pantalla desde el título central
        tx: `${(Math.random() - 0.5) * 90}vw`, 
        ty: `${(Math.random() - 0.5) * 90}vh`,
      };
      setFloatingLetters((prev) => [...prev.slice(-30), newLetter]);
    }, 70);

    return () => clearInterval(interval);
  }, [narrativeStep]);

  useEffect(() => {
    if (narrativeStep === 2) {
      const timer = setTimeout(() => {
        setNarrativeStep(3);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [narrativeStep]);

  // Carga asíncrona de recursos de Leaflet (Mapas)
  useEffect(() => {
    if (narrativeStep !== 8) return;

    // Cargar CSS de Leaflet
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    // Cargar JS de Leaflet
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => setLeafletLoaded(true);
      document.head.appendChild(script);
    } else {
      if ((window as any).L) {
        setLeafletLoaded(true);
      }
    }
  }, [narrativeStep]);

  // Inicializar Leaflet y centrar usando Geolocalización del navegador
  useEffect(() => {
    if (narrativeStep !== 8 || !leafletLoaded) return;

    const L = (window as any).L;
    if (!L) return;

    // Obtener ubicación de la usuaria o por defecto centrar en Lima, Perú
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        initMap(lat, lng);
      },
      () => {
        initMap(-12.0464, -77.0428);
      }
    );

    function initMap(initialLat: number, initialLng: number) {
      if (mapRef.current) {
        mapRef.current.remove();
      }

      // Crear mapa
      const map = L.map("leaflet-map").setView([initialLat, initialLng], 14);
      mapRef.current = map;

      // Cargar azulejos de OpenStreetMap
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      // Icono SVG personalizado de PIN rojo (evita problemas de assets rotos en empaquetadores)
      const customPinIcon = L.divIcon({
        html: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                 <path d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2ZM12 11.5C10.62 11.5 9.5 10.38 9.5 9C9.5 7.62 10.62 6.5 12 6.5C13.38 6.5 14.5 7.62 14.5 9C14.5 10.38 13.38 11.5 12 11.5Z" fill="#ef4444"/>
               </svg>`,
        className: "custom-leaflet-pin",
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      // Crear pin arrastrable
      const marker = L.marker([initialLat, initialLng], { 
        draggable: true,
        icon: customPinIcon,
      }).addTo(map);
      markerRef.current = marker;

      // Establecer coordenadas iniciales
      setLatitude(initialLat);
      setLongitude(initialLng);

      // Mover pin al hacer clic en el mapa
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        marker.setLatLng([lat, lng]);
        setLatitude(lat);
        setLongitude(lng);
      });

      // Actualizar coordenadas al finalizar arrastre
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        setLatitude(lat);
        setLongitude(lng);
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [narrativeStep, leafletLoaded]);

  // Insertar respuestas en Supabase al llegar al final (Paso 7)
  useEffect(() => {
    if (narrativeStep === 7 && !hasInsertedRef.current) {
      hasInsertedRef.current = true;
      const saveResponse = async () => {
        try {
          const { error } = await supabase
            .from("sushiday_responses")
            .insert({
              free_weekend: freeWeekend ?? true,
              free_day: freeDay || "No especificado",
              meeting_time: meetingTime || "No especificada",
              trust_taste: trustTaste ?? false,
              fav_sushi_place: favSushiPlace || null,
              latitude: latitude || null,
              longitude: longitude || null,
            });
          if (error) {
            console.error("Supabase insert error:", error);
          } else {
            console.log("Response stored successfully in Supabase.");
          }
        } catch (err) {
          console.error("Supabase insert exception:", err);
        }
      };
      saveResponse();
    }
  }, [narrativeStep, freeWeekend, freeDay, meetingTime, trustTaste, favSushiPlace, latitude, longitude]);

  // Foco de cumpleaños
  const handleDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length >= 2) {
      monthRef.current?.focus();
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length >= 2) {
      yearRef.current?.focus();
    }
  };

  const handleMonthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !e.currentTarget.value) {
      e.preventDefault();
      dayRef.current?.focus();
      if (dayRef.current) {
        const val = dayRef.current.value;
        if (val.length > 0) {
          const newVal = val.slice(0, -1);
          setValue("day", newVal, { shouldValidate: true });
        }
      }
    }
  };

  const handleYearKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !e.currentTarget.value) {
      e.preventDefault();
      monthRef.current?.focus();
      if (monthRef.current) {
        const val = monthRef.current.value;
        if (val.length > 0) {
          const newVal = val.slice(0, -1);
          setValue("month", newVal, { shouldValidate: true });
        }
      }
    }
  };

  const handleTimeConfirm = () => {
    if (!hourVal || !minVal) {
      setTimeError("Selecciona hora y minutos");
      return;
    }

    setTimeError("");
    const hh = parseInt(hourVal, 10);
    const mm = parseInt(minVal, 10);

    // Calcular hora en formato 24 horas para validar rango
    let hour24 = hh;
    if (ampmVal === "PM" && hh !== 12) {
      hour24 += 12;
    } else if (ampmVal === "AM" && hh === 12) {
      hour24 = 0;
    }

    const minutesTotal = hour24 * 60 + mm;
    const isTooEarly = minutesTotal < 540;  // Antes de las 9:00 AM (9 * 60 = 540)
    const isTooLate = minutesTotal > 1200; // Después de las 8:00 PM (20 * 60 = 1200)

    if (isTooEarly) {
      setTimeWarningMessage("¡Vamos, escoge otro horario, está muy temprano! Jajaja 🥺");
      setIsTimeWarningStrict(true); // Estricto: no deja confirmar, solo cambiar
      setShowTimeWarningModal(true);
      return;
    }

    if (isTooLate) {
      setTimeWarningMessage("Está muy tarde, jajaja ¿segura a ese horario?");
      setIsTimeWarningStrict(false); // No estricto: deja confirmar
      setShowTimeWarningModal(true);
      return;
    }

    // Hora en rango seguro, proceder inmediatamente
    const formattedTime = `${hourVal}:${minVal} ${ampmVal}`;
    setMeetingTime(formattedTime);

    setShowQ3TimeInput(false);
    setTimeout(() => {
      setNarrativeStep(6);
    }, 500);
  };

  const handleQ1Answer = (ans: boolean) => {
    setFreeWeekend(ans);
    setShowQ1Options(false);
    setTimeout(() => {
      setNarrativeStep(4);
    }, 500);
  };

  const handleQ2Answer = (day: "Sábado" | "Domingo") => {
    setFreeDay(day);
    setShowQ2Options(false);
    setTimeout(() => {
      setNarrativeStep(5);
    }, 500);
  };

  const handleQ4Answer = (ans: boolean) => {
    setTrustTaste(ans);
    setShowQ4Options(false);
    setTimeout(() => {
      if (ans) {
        setNarrativeStep(7);
      } else {
        setNarrativeStep(8);
      }
    }, 500);
  };

  // Botón "No" de la Pregunta 1
  const handleQ1NoButtonEscape = () => {
    const jumpX = -60 - Math.random() * 110;
    const jumpY = 40 + Math.random() * 90;
    setQ1NoBtnOffset({ x: jumpX, y: jumpY });
  };

  const envelopeVariants: Variants = {
    closed: {
      y: "0%",
      scale: 1,
      opacity: 1,
      rotateX: 0,
      rotateY: 0,
      filter: "blur(0px)",
      transition: { duration: 0.8, ease: [0.25, 1, 0.5, 1] },
    },
    open: {
      y: "32%",
      scale: 1,
      opacity: 1,
      rotateX: 0,
      rotateY: 0,
      filter: "blur(0px)",
      transition: { delay: 0.35, duration: 0.85, ease: [0.25, 1, 0.5, 1] },
    },
    disappeared: {
      y: "0%",
      scale: 0.3,
      opacity: 0,
      rotateX: 85,
      rotateY: -45,
      filter: "blur(20px)",
      transition: { duration: 1.1, ease: [0.34, 1.3, 0.64, 1] },
    },
  };

  const flapVariants: Variants = {
    closed: {
      y: "0%",
      rotateX: 0,
      scale: 1,
      opacity: 1,
      rotateY: 0,
      filter: "blur(0px)",
      zIndex: 40,
      transition: {
        y: { duration: 0.8, ease: [0.25, 1, 0.5, 1] },
        rotateX: { duration: 0.55, ease: "easeInOut" },
      },
    },
    open: {
      y: "32%",
      rotateX: 180,
      scale: 1,
      opacity: 1,
      rotateY: 0,
      filter: "blur(0px)",
      zIndex: 15,
      transition: {
        y: { delay: 0.35, duration: 0.85, ease: [0.25, 1, 0.5, 1] },
        rotateX: { duration: 0.55, ease: "easeInOut" },
        zIndex: { delay: 0.22 },
      },
    },
    disappeared: {
      y: "0%",
      scale: 0.3,
      opacity: 0,
      rotateX: 85,
      rotateY: -45,
      filter: "blur(20px)",
      transition: { duration: 1.1, ease: [0.34, 1.3, 0.64, 1] },
    },
  };

  const paperVariants: Variants = {
    closed: {
      y: "12%",
      opacity: 0,
      scale: 0.96,
      pointerEvents: "none",
      transition: { duration: 0.6, ease: "easeIn" },
    },
    open: {
      y: "-68%",
      opacity: 1,
      scale: 1,
      pointerEvents: "auto",
      transition: { delay: 0.42, duration: 0.9, ease: [0.25, 1, 0.5, 1] },
    },
  };

  const getEnvelopeAnimationState = () => {
    if (isEnvelopeDisappeared) return "disappeared";
    return isOpen ? "open" : "closed";
  };

  const getSubtitleText = () => {
    return isEnvelopeDisappeared ? "" : "UNA INVITACION TE ESPERA";
  };

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Animación del Fondo */}
      <BackgroundAnimation />

      {/* Lluvia final de flores Licoris Radiata en 3D */}
      {narrativeStep === 7 && (
        <FallingFlowers hasMounted={hasMounted} model={model} />
      )}

      {/* PASO 1: Frase poética arriba a la izquierda */}
      <AnimatePresence>
        {narrativeStep === 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute top-12 left-6 md:top-24 md:left-24 max-w-xs md:max-w-lg text-left select-none z-48"
          >
            <p className="font-display text-xl md:text-2xl font-light italic leading-relaxed text-neutral-800">
              <TypewriterText 
                text="Primero, sé que esto es un poco tarde, pero dicen que el tiempo es relativo, ¿no? Jamás es tarde, nunca es tarde para un feliz cumpleaños." 
                onComplete={() => {
                  setTimeout(() => {
                    setNarrativeStep(2);
                  }, 6500);
                }}
              />
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASO 3 (Pregunta 1): ¿Tienes libre este fin de semana? (Top-Right) */}
      <AnimatePresence>
        {narrativeStep === 3 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-16 right-6 md:top-24 md:right-24 max-w-xs md:max-w-md text-right select-none z-48 flex flex-col items-end"
          >
            <h2 className="font-display text-2xl font-light tracking-tight text-neutral-800">
              <TypewriterText 
                key="q1"
                text="¿Tienes libre este fin de semana?" 
                onComplete={() => setShowQ1Options(true)}
              />
            </h2>
            
            <AnimatePresence>
              {showQ1Options && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4 mt-6 relative"
                >
                  <button
                    onClick={() => handleQ1Answer(true)}
                    className="px-6 py-2.5 border border-neutral-350 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 hover:bg-neutral-50/50 transition-all duration-300 rounded-sm cursor-pointer"
                  >
                    Sí
                  </button>
                  
                  {/* Botón "No" de la Q1 - Solo salta a la izquierda y abajo */}
                  <motion.button
                    type="button"
                    animate={{ x: q1NoBtnOffset.x, y: q1NoBtnOffset.y }}
                    transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    onMouseEnter={handleQ1NoButtonEscape}
                    onTouchStart={handleQ1NoButtonEscape}
                    onClick={handleQ1NoButtonEscape}
                    className="px-6 py-2.5 border border-neutral-350 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-neutral-755 transition-colors duration-305 rounded-sm cursor-pointer"
                  >
                    No
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASO 4 (Pregunta 2): ¿Qué día estás libre? (Bottom-Left) */}
      <AnimatePresence>
        {narrativeStep === 4 && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1] }}
            className="absolute bottom-28 left-6 md:bottom-36 md:left-24 max-w-xs md:max-w-md text-left select-none z-48 flex flex-col items-start"
          >
            <h2 className="font-display text-2xl font-light tracking-tight text-neutral-800">
              <TypewriterText 
                key="q2"
                text="¡Jajaja, lo sabía! Sabía que tenías libre 😌 ¿Qué día estás libre?" 
                onComplete={() => setShowQ2Options(true)}
              />
            </h2>
            
            <AnimatePresence>
              {showQ2Options && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-4 mt-6"
                >
                  <button
                    onClick={() => handleQ2Answer("Sábado")}
                    className="px-6 py-2.5 border border-neutral-350 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 hover:bg-neutral-50/50 transition-all duration-300 rounded-sm cursor-pointer"
                  >
                    Sábado
                  </button>
                  <button
                    onClick={() => handleQ2Answer("Domingo")}
                    className="px-6 py-2.5 border border-neutral-350 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 hover:bg-neutral-50/50 transition-all duration-300 rounded-sm cursor-pointer"
                  >
                    Domingo
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASO 5 (Pregunta 3): Hora del encuentro (HH:MM AM/PM con Selects) (Center-Top) */}
      <AnimatePresence>
        {narrativeStep === 5 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-16 left-6 right-6 text-center max-w-xl mx-auto select-none z-48 flex flex-col items-center"
          >
            <h2 className="font-display text-xl md:text-2xl font-light tracking-tight leading-relaxed text-neutral-800 max-w-lg">
              <TypewriterText 
                key="q3"
                text="Muy bien, te encuentras libre :3 Y como lo prometido es deuda, dime ¿a qué hora nos vemos para celebrar tu cumple?" 
                onComplete={() => setShowQ3TimeInput(true)}
              />
            </h2>
            
            <AnimatePresence>
              {showQ3TimeInput && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center mt-6 gap-3"
                >
                  <div className="flex items-center gap-2">
                    {/* Desplegable de Hora */}
                    <select
                      value={hourVal}
                      onChange={(e) => setHourVal(e.target.value)}
                      className="w-16 border-b border-neutral-250 bg-transparent py-1 text-center font-display text-2xl outline-none focus:border-neutral-800 text-neutral-800 appearance-none cursor-pointer"
                    >
                      <option value="" disabled className="bg-[#fafaf7]">HH</option>
                      {Array.from({ length: 12 }).map((_, i) => {
                        const h = String(i + 1).padStart(2, "0");
                        return (
                          <option key={h} value={h} className="bg-[#fafaf7] text-neutral-800 text-sm">
                            {h}
                          </option>
                        );
                      })}
                    </select>

                    <span className="text-xl font-light text-neutral-455">:</span>

                    {/* Desplegable de Minutos */}
                    <select
                      value={minVal}
                      onChange={(e) => setMinVal(e.target.value)}
                      className="w-16 border-b border-neutral-250 bg-transparent py-1 text-center font-display text-2xl outline-none focus:border-neutral-800 text-neutral-800 appearance-none cursor-pointer"
                    >
                      <option value="" disabled className="bg-[#fafaf7]">MM</option>
                      {Array.from({ length: 12 }).map((_, i) => {
                        const m = String(i * 5).padStart(2, "0");
                        return (
                          <option key={m} value={m} className="bg-[#fafaf7] text-neutral-800 text-sm">
                            {m}
                          </option>
                        );
                      })}
                    </select>

                    {/* Botón AM/PM */}
                    <button
                      type="button"
                      onClick={() => setAmpmVal(prev => prev === "AM" ? "PM" : "AM")}
                      className="ml-2 px-3.5 py-1.5 border border-neutral-300 text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-neutral-755 hover:border-neutral-855 hover:text-neutral-900 transition-colors duration-305 rounded-sm cursor-pointer min-w-[54px] text-center"
                    >
                      {ampmVal}
                    </button>
                    
                    <button
                      onClick={handleTimeConfirm}
                      className="ml-4 px-5 py-2 border border-neutral-900 bg-neutral-900 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white hover:bg-neutral-800 transition-all duration-305 rounded-sm cursor-pointer"
                    >
                      Confirmar
                    </button>
                  </div>
                  {timeError && (
                    <span className="text-[0.62rem] text-red-400 font-medium">{timeError}</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Advertencia de Horario Playful */}
      <AnimatePresence>
        {showTimeWarningModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-md px-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-full max-w-sm rounded-lg border border-neutral-200 bg-[#fafaf7] p-6 shadow-xl text-center select-none"
            >
              <p className="font-display text-lg font-light text-neutral-800 leading-relaxed">
                {timeWarningMessage}
              </p>
              <p className="mt-2 text-[0.7rem] font-mono text-neutral-455 uppercase tracking-widest">
                {`${hourVal}:${minVal} ${ampmVal}`}
              </p>
              
              <div className="flex gap-4 mt-6 justify-center">
                {isTimeWarningStrict ? (
                  <button
                    onClick={() => setShowTimeWarningModal(false)}
                    className="px-6 py-2.5 border border-neutral-900 bg-neutral-900 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white hover:bg-neutral-800 transition-colors duration-300 rounded-sm cursor-pointer"
                  >
                    Cambiar
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowTimeWarningModal(false)}
                      className="px-5 py-2.5 border border-neutral-350 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 transition-colors duration-300 rounded-sm cursor-pointer"
                    >
                      Cambiar
                    </button>
                    <button
                      onClick={() => {
                        setShowTimeWarningModal(false);
                        const formattedTime = `${hourVal}:${minVal} ${ampmVal}`;
                        setMeetingTime(formattedTime);
                        setShowQ3TimeInput(false);
                        setTimeout(() => {
                          setNarrativeStep(6);
                        }, 500);
                      }}
                      className="px-5 py-2.5 border border-neutral-900 bg-neutral-900 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white hover:bg-neutral-800 transition-colors duration-300 rounded-sm cursor-pointer"
                    >
                      Sí, segura
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASO 6 (Pregunta 4): ¿Confías en mi excelente gusto? (Center-Top) */}
      <AnimatePresence>
        {narrativeStep === 6 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-20 left-6 right-6 text-center max-w-xl mx-auto select-none z-48 flex flex-col items-center"
          >
            <h2 className="font-display text-2xl md:text-3xl font-light tracking-tight text-neutral-800">
              <TypewriterText 
                key="q4"
                text="¿Confías en mi excelente gusto y que sabré escoger un buen sitio para ir a comer sushi?" 
                onComplete={() => setShowQ4Options(true)}
              />
            </h2>
            
            <AnimatePresence>
              {showQ4Options && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-6 mt-8 relative"
                >
                  <button
                    onClick={() => handleQ4Answer(true)}
                    className="px-8 py-3 border border-neutral-350 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-855 hover:text-neutral-900 hover:bg-neutral-50/50 transition-all duration-305 rounded-sm cursor-pointer"
                  >
                    Sí
                  </button>

                  <button
                    onClick={() => handleQ4Answer(false)}
                    className="px-8 py-3 border border-neutral-350 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-neutral-700 hover:border-neutral-855 hover:text-neutral-900 hover:bg-neutral-50/50 transition-all duration-305 rounded-sm cursor-pointer"
                  >
                    No
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASO 8 (Pregunta 4.5): ¿Cuál es el lugar de sushi que más te gusta? (Center-Top con Mapa) */}
      <AnimatePresence>
        {narrativeStep === 8 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1] }}
            className="absolute top-20 left-6 right-6 text-center max-w-xl mx-auto select-none z-48 flex flex-col items-center"
          >
            <h2 className="font-display text-xl md:text-2xl font-light tracking-tight leading-relaxed text-neutral-800 max-w-lg">
              <TypewriterText 
                key="q4_5"
                text="Está bien, comprendo jajaja Dime cuál es el lugar de sushi que más te gusta, pon aquí el nombre:" 
                onComplete={() => setShowSushiPlaceInput(true)}
              />
            </h2>
            
            <AnimatePresence>
              {showSushiPlaceInput && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center mt-6 gap-4 w-full px-4"
                >
                  <input
                    type="text"
                    placeholder="Ej. Sushi Corp, etc."
                    value={favSushiPlace}
                    onChange={(e) => setFavSushiPlace(e.target.value)}
                    className="w-64 border-b border-neutral-250 bg-transparent py-1.5 text-center font-display text-xl outline-none focus:border-neutral-800 text-neutral-800"
                  />

                  {/* Div del Mapa de Leaflet */}
                  <div className="w-full max-w-md flex flex-col items-center mt-2">
                    <p className="text-[0.62rem] text-neutral-450 uppercase tracking-widest mb-2 font-mono">
                      Selecciona la ubicación exacta en el mapa:
                    </p>
                    <div 
                      id="leaflet-map" 
                      className="w-full h-48 rounded-sm border border-neutral-250 pointer-events-auto shadow-sm relative z-50 bg-neutral-50"
                      style={{ minHeight: "192px" }}
                    >
                      {!leafletLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-400 font-mono">
                          Cargando mapa...
                        </div>
                      )}
                    </div>
                    {latitude !== null && longitude !== null && (
                      <span className="text-[9px] font-mono text-neutral-400 mt-2">
                        Lat: {latitude.toFixed(6)} | Lng: {longitude.toFixed(6)}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      if (!favSushiPlace.trim()) return;
                      setNarrativeStep(7);
                    }}
                    className="px-6 py-2.5 border border-neutral-900 bg-neutral-900 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-white hover:bg-neutral-800 transition-all duration-305 rounded-sm cursor-pointer"
                  >
                    Confirmar
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contenedor Central */}
      <div className="relative z-10 flex w-full max-w-[450px] flex-col items-center">
        
        {/* Encabezado Principal Glitch */}
        <motion.div
          animate={{ 
            opacity: isOpen ? 0 : 1,
            y: isEnvelopeDisappeared ? 195 : isOpen ? -15 : 0,
            scale: isEnvelopeDisappeared ? 1.15 : 1,
          }}
          transition={{ duration: 1.1, ease: [0.25, 1, 0.5, 1] }}
          className="pointer-events-none mb-10 text-center select-none z-48 relative w-full flex flex-col items-center px-4"
        >
          {/* Flor interactiva 3D detrás de los textos en el Paso 7 (Subida visualmente en z-space) */}
          {narrativeStep === 7 && hasMounted && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 1.6, ease: [0.25, 1, 0.5, 1] }}
              className="absolute w-full h-[420px] -top-44 left-0 z-35 cursor-grab active:cursor-grabbing pointer-events-auto"
            >
              <CanvasErrorBoundary>
                {modelLoading && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-neutral-455 font-mono tracking-widest">
                    Cargando elemento 3D...
                  </div>
                )}
                {modelError && (
                  <div className="absolute inset-0 flex items-center justify-center text-[9px] text-red-400 font-mono p-2 text-center">
                    Error al cargar flor 3D: {modelError.message || String(modelError)}
                  </div>
                )}
                {model && (
                  <Canvas
                    camera={{ position: [0, 0, 3.4], fov: 45 }}
                    gl={{ alpha: true, antialias: true }}
                    style={{ background: "transparent", width: "100%", height: "100%" }}
                  >
                    <ambientLight intensity={2.0} />
                    <directionalLight position={[2, 5, 2]} intensity={2.5} />
                    <InteractiveFlowerModel model={model} />
                    <OrbitControls 
                      enableZoom={false} 
                      enablePan={false} 
                      autoRotate 
                      autoRotateSpeed={0.8}
                      maxPolarAngle={Math.PI / 1.8}
                      minPolarAngle={Math.PI / 6}
                    />
                  </Canvas>
                )}
              </CanvasErrorBoundary>
            </motion.div>
          )}

          {/* Contenedor de Textos del Título con z-index alto para estar al frente */}
          <div className="relative z-45 flex flex-col items-center w-full select-none pointer-events-none">
            <h1 
              className={`font-mono text-3xl font-light tracking-[0.25em] uppercase transition-colors duration-500 ${
                showErrorIndicator ? "text-red-500" : "text-neutral-800"
              }`}
            >
              <GlitchText text="SUSHIDAY" active={!isOpen && narrativeStep < 5} />
            </h1>

            {/* Decoplado de la cita final para tener transición suave y escalonada */}
            {narrativeStep < 7 ? (
              <p 
                className={`mt-3 font-mono text-[0.62rem] md:text-[0.68rem] tracking-[0.18em] uppercase transition-colors duration-500 max-w-sm md:max-w-md ${
                  showErrorIndicator ? "text-red-400" : "text-neutral-450"
                }`}
              >
                <GlitchText text={getSubtitleText()} active={!isOpen && narrativeStep < 7} />
              </p>
            ) : (
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2, duration: 1.2, ease: "easeOut" }}
                className="mt-3 font-mono text-[0.62rem] md:text-[0.68rem] tracking-[0.18em] uppercase text-neutral-455 max-w-sm md:max-w-md"
              >
                {`TE ESPERO EL ${freeDay?.toUpperCase()} A LAS ${meetingTime}`}
              </motion.p>
            )}

            {/* Mensaje de confianza/cita final (Paso 7) con transición suave retrasada */}
            <AnimatePresence>
              {narrativeStep === 7 && !trustTaste && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 0.85, y: 0 }}
                  transition={{ delay: 2.4, duration: 1.2, ease: "easeOut" }}
                  className="mt-6 font-display text-[0.78rem] md:text-sm font-light italic text-neutral-500 max-w-xs md:max-w-md"
                >
                  Entonces iremos al lugar que escribiste
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Partículas de letras que se desprenden del glitch central hacia la esquina superior izquierda (Paso 1) */}
          {floatingLetters.map((l) => (
            <motion.span
              key={l.id}
              initial={{ x: 0, y: 0, opacity: 0.8, scale: 0.8 }}
              animate={{ x: l.tx, y: l.ty, opacity: 0, scale: 0.5 }}
              transition={{ duration: 1.6, ease: "easeOut" }}
              className="absolute font-mono text-[0.65rem] text-neutral-400/60 pointer-events-none select-none"
            >
              {l.char}
            </motion.span>
          ))}
        </motion.div>

        {/* Contenedor del Sobre e Invitación con Perspectiva 3D */}
        <div className="relative w-full aspect-[1.5/1]" style={{ perspective: "1200px" }}>
          
          {/* 1. Fondo del sobre (Interior/Espacio) y Bolsillo (Z-Index: 10) */}
          <motion.div
            variants={envelopeVariants}
            initial="closed"
            animate={getEnvelopeAnimationState()}
            className="absolute inset-0 z-10"
          >
            <div className="absolute inset-0 rounded-lg bg-[#121212] shadow-[0_16px_40px_rgba(0,0,0,0.15)]" />
            <div
              className="absolute inset-0 rounded-t-lg bg-[#0d0d0f]"
              style={{ clipPath: "polygon(0 0, 100% 0, 50% 50%)" }}
            />
          </motion.div>

          {/* 2. Solapa Superior (Flap Triangular) (Z-Index: 40 cerrado, 15 abierto) */}
          <motion.div
            variants={flapVariants}
            initial="closed"
            animate={getEnvelopeAnimationState()}
            className="absolute inset-0 origin-top"
            style={{
              transformStyle: "preserve-3d",
              backfaceVisibility: "visible",
            }}
          >
            <svg
              width="100%"
              height="50%"
              viewBox="0 0 450 150"
              preserveAspectRatio="none"
              fill="none"
              className="overflow-visible"
            >
              <path d="M 0,0 L 225,150 L 450,0 Z" fill="#202022" />
              <path d="M 0,0 L 225,150 L 450,0" stroke="#2a2a2d" strokeWidth="0.75" />
            </svg>
          </motion.div>

          {/* 3. La Carta / Invitación (Papel) (Z-Index: 20) */}
          <motion.div
            variants={paperVariants}
            initial="closed"
            animate={isOpen ? "open" : "closed"}
            className="absolute inset-x-5 top-5 z-20 flex h-[116%] flex-col justify-between rounded-sm border border-[#e5e5e0] bg-[#fafaf7] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.03)] sm:p-8"
          >
            <div className="flex h-full flex-col justify-between">
              <div className="text-center pt-2">
                <p className="text-[0.7rem] leading-relaxed text-neutral-500 font-light max-w-sm mx-auto">
                  Para poder verificar esta invitación válida por favor coloca tu cumpleaños, de ser el correcto se te mostrarán más detalles a continuación.
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <Field
                    label="Día"
                    placeholder="00"
                    error={errors.day?.message}
                    registration={register("day")}
                    inputRef={dayRef}
                    onInputChange={handleDayChange}
                  />
                  <Field
                    label="Mes"
                    placeholder="00"
                    error={errors.month?.message}
                    registration={register("month")}
                    inputRef={monthRef}
                    onInputChange={handleMonthChange}
                    onInputKeyDown={handleMonthKeyDown}
                  />
                  <Field
                    label="Año"
                    placeholder="0000"
                    error={errors.year?.message}
                    registration={register("year")}
                    inputRef={yearRef}
                    onInputKeyDown={handleYearKeyDown}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center border border-neutral-900 bg-neutral-900 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Validando..." : "Acceder"}
                </button>
              </form>
            </div>
          </motion.div>

          {/* 4. Solapas Frontales (Izquierda, Derecha, Abajo) (Z-Index: 30) */}
          <motion.div
            variants={envelopeVariants}
            initial="closed"
            animate={getEnvelopeAnimationState()}
            className="absolute inset-0 z-30 pointer-events-none"
          >
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 450 300"
              preserveAspectRatio="none"
              fill="none"
              className="w-full h-full overflow-visible"
            >
              {/* Solapa Izquierda */}
              <path d="M 0,0 L 225,150 L 0,300 Z" fill="#18181a" />
              {/* Solapa Derecha */}
              <path d="M 450,0 L 225,150 L 450,300 Z" fill="#141416" />
              {/* Solapa Inferior */}
              <path d="M 0,300 L 225,150 L 450,300 Z" fill="#1c1c1e" />

              {/* Bordes finos de pliegue para realismo táctil */}
              <path d="M 0,0 L 225,150" stroke="#242427" strokeWidth="0.75" />
              <path d="M 450,0 L 225,150" stroke="#202023" strokeWidth="0.75" />
              <path d="M 0,300 L 225,150 L 450,300" stroke="#28282b" strokeWidth="0.75" />
            </svg>
          </motion.div>

          {/* 5. Capa de Éxito Centrada (Z-Index: 45) */}
          <AnimatePresence>
            {showSuccessIndicator && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 z-45 flex flex-col items-center justify-center p-6 text-center pointer-events-none"
              >
                {/* Visto (Checkmark) verde ligero */}
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f4fbf7]/90 border border-emerald-100 shadow-[0_4px_12px_rgba(16,185,129,0.06)]">
                  <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-emerald-600">
                  correcto
                </p>
                <p className="mt-1.5 text-[0.62rem] tracking-[0.08em] text-emerald-600/80">
                  si eres tu Maye contunemos ...
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 6. Capa de Error Centrada (Z-Index: 45) */}
          <AnimatePresence>
            {showErrorIndicator && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="absolute inset-0 z-45 flex flex-col items-center justify-center p-6 text-center pointer-events-none"
              >
                {/* Cruz (X) roja ligera */}
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fdf2f2]/90 border border-red-100 shadow-[0_4px_12px_rgba(239,68,68,0.06)]">
                  <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-red-600">
                  fecha incorrecta !!
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 7. Capa Invisible para Clics (Solo visible cuando el sobre está cerrado y no hay indicador activo) */}
          {!isOpen && !showSuccessIndicator && !showErrorIndicator && !isEnvelopeDisappeared && (
            <div
              onClick={() => setIsOpen(true)}
              className="absolute inset-0 z-50 cursor-pointer rounded-lg"
            />
          )}

        </div>
        
        {/* Hint inferior cuando el sobre está cerrado */}
        <motion.p
          animate={{ 
            opacity: (isOpen || showSuccessIndicator || showErrorIndicator || isEnvelopeDisappeared) ? 0 : 0.6, 
            y: (isOpen || showSuccessIndicator || showErrorIndicator || isEnvelopeDisappeared) ? 10 : 0 
          }}
          transition={{ duration: 0.4 }}
          className="mt-8 text-[0.62rem] uppercase tracking-[0.25em] text-neutral-500 pointer-events-none"
        >
          Haz clic para abrir el sobre
        </motion.p>

      </div>
    </section>
  );
}

type FieldProps = {
  error?: string;
  label: string;
  placeholder: string;
  registration: UseFormRegisterReturn;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onInputKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

function Field({ error, label, placeholder, registration, inputRef, onInputChange, onInputKeyDown }: FieldProps) {
  const { ref: formRef, onChange: formOnChange, ...restReg } = registration;
  
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-neutral-400 text-center">
        {label}
      </span>
      <input
        {...restReg}
        ref={(e) => {
          formRef(e);
          if (inputRef) {
            (inputRef as any).current = e;
          }
        }}
        onChange={(e) => {
          e.target.value = e.target.value.replace(/\D/g, "");
          formOnChange(e);
          if (onInputChange) {
            onInputChange(e);
          }
        }}
        onKeyDown={onInputKeyDown}
        inputMode="numeric"
        maxLength={label === "Año" ? 4 : 2}
        placeholder={placeholder}
        className={`w-full border-b bg-transparent py-2 text-center font-display text-2xl outline-none transition-colors duration-305 placeholder:text-neutral-300 ${
          error ? "border-red-300 focus:border-red-500 text-red-700" : "border-neutral-200 focus:border-neutral-800 text-neutral-800"
        }`}
      />
      <span className="min-h-[14px] text-[0.62rem] text-red-400 text-center font-medium">
        {error ?? ""}
      </span>
    </div>
  );
}
