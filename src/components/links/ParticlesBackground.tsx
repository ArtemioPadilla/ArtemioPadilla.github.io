import { useEffect, useRef } from "preact/hooks";

export default function ParticlesBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const init = async () => {
      const { tsParticles } = await import("tsparticles-engine");
      const { loadSlim } = await import("tsparticles-slim");

      await loadSlim(tsParticles);

      const container = await tsParticles.load("particles-js", {
        fullScreen: false,
        particles: {
          number: {
            value: 160,
            density: {
              enable: true,
              area: 1200,
            },
          },
          color: { value: "#ffffff" },
          shape: { type: "circle" },
          opacity: {
            value: { min: 0.05, max: 0.8 },
            animation: {
              enable: true,
              speed: 0.4,
              sync: false,
            },
          },
          size: {
            value: { min: 0.5, max: 2.5 },
          },
          links: {
            enable: true,
            distance: 80,
            color: "#ffffff",
            opacity: 0.08,
            width: 0.5,
          },
          move: {
            enable: true,
            speed: 0.3,
            direction: "none",
            random: true,
            straight: false,
            outModes: { default: "out" },
          },
        },
        interactivity: {
          detectsOn: "window",
          events: {
            onHover: {
              enable: true,
              mode: "grab",
            },
            onClick: {
              enable: true,
              mode: "push",
            },
            resize: true,
          },
          modes: {
            grab: {
              distance: 200,
              links: { opacity: 0.3 },
            },
            push: { quantity: 3 },
          },
        },
        detectRetina: true,
      });

      cleanup = () => {
        container?.destroy();
      };
    };

    init();

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <div
      id="particles-js"
      ref={containerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "#000000",
        zIndex: 0,
      }}
    />
  );
}
