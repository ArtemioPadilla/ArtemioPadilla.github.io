import type { FunctionalComponent } from "preact";

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  currentLine: number | null;
  exceptionLine: number | null;
  isTraceActive: boolean;
}

const CodeEditor: FunctionalComponent<CodeEditorProps> = ({
  code,
  onCodeChange,
  currentLine,
  exceptionLine,
  isTraceActive,
}) => {
  const lines = code.split("\n");

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal =
        ta.value.substring(0, start) + "    " + ta.value.substring(end);
      onCodeChange(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4;
      });
    }
  };

  if (isTraceActive) {
    return (
      <div class="code-editor-trace h-full overflow-auto">
        <pre class="m-0 p-0 font-mono text-sm leading-relaxed">
          {lines.map((line, i) => {
            const lineNum = i + 1;
            const isCurrent = lineNum === currentLine;
            const isException = lineNum === exceptionLine;

            let lineClass =
              "flex items-start border-l-3 px-3 py-0.5 transition-colors duration-150";
            if (isException) {
              lineClass +=
                " border-l-red-400 bg-red-400/10";
            } else if (isCurrent) {
              lineClass +=
                " border-l-[var(--color-primary)] bg-[var(--color-primary)]/10";
            } else {
              lineClass += " border-l-transparent";
            }

            return (
              <div key={i} class={lineClass}>
                <span
                  class="mr-4 inline-block w-8 shrink-0 select-none text-right text-xs leading-relaxed text-[var(--color-text-muted)]/50"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {lineNum}
                </span>
                <span class="text-[var(--color-text)] whitespace-pre">
                  {line || " "}
                </span>
              </div>
            );
          })}
        </pre>
      </div>
    );
  }

  return (
    <div class="code-editor-edit relative h-full">
      <textarea
        value={code}
        onInput={(e) =>
          onCodeChange((e.target as HTMLTextAreaElement).value)
        }
        onKeyDown={handleKeyDown}
        class="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none"
        style={{ tabSize: 4 }}
        rows={16}
        spellcheck={false}
        autocorrect="off"
        autocapitalize="off"
        placeholder="Write Python code here..."
      />
    </div>
  );
};

export default CodeEditor;
