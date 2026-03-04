import { useEffect, useRef, useState } from "preact/hooks";

export default function ParticlesBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));

    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const init = async () => {
      const { tsParticles } = await import("tsparticles-engine");
      const { loadSlim } = await import("tsparticles-slim");

      await loadSlim(tsParticles);

      const particleColor = isLight ? "#71717a" : "#ffffff";
      const linkColor = isLight ? "#71717a" : "#ffffff";
      const bgColor = isLight ? "#fafafa" : "#000000";

      const existing = tsParticles.domItem(0);
      if (existing) {
        existing.destroy();
      }

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
          color: { value: particleColor },
          shape: { type: "circle" },
          opacity: {
            value: { min: 0.05, max: isLight ? 0.5 : 0.8 },
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
            color: linkColor,
            opacity: isLight ? 0.12 : 0.08,
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
  }, [isLight]);

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
        backgroundColor: isLight ? "#fafafa" : "#000000",
        zIndex: 0,
        transition: "background-color 0.3s ease",
      }}
    />
  );
}
