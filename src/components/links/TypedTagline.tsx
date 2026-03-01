import { useEffect, useRef } from "preact/hooks";

interface Props {
  items: string[];
}

export default function TypedTagline({ items }: Props) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let typed: any;

    const init = async () => {
      const Typed = (await import("typed.js")).default;
      if (spanRef.current) {
        typed = new Typed(spanRef.current, {
          strings: items,
          loop: true,
          typeSpeed: 100,
          backSpeed: 50,
          backDelay: 2000,
          showCursor: false,
        });
      }
    };

    init();

    return () => {
      typed?.destroy();
    };
  }, [items]);

  return (
    <div class="typed_wrap">
      <h1>
        <span ref={spanRef} class="typed" />
      </h1>
    </div>
  );
}
