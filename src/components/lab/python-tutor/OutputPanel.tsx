import type { FunctionalComponent } from "preact";

interface OutputPanelProps {
  stdout: string;
  exceptionMsg?: string;
}

const OutputPanel: FunctionalComponent<OutputPanelProps> = ({
  stdout,
  exceptionMsg,
}) => {
  const hasContent = stdout.length > 0 || exceptionMsg;

  return (
    <div class="output-panel h-full overflow-auto p-4 font-mono text-sm leading-relaxed">
      {!hasContent ? (
        <p class="text-[var(--color-text-muted)]/40 italic">
          Program output will appear here...
        </p>
      ) : (
        <>
          {stdout && (
            <pre class="m-0 whitespace-pre-wrap break-words text-[var(--color-text)]">
              {stdout}
            </pre>
          )}
          {exceptionMsg && (
            <div class="mt-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2">
              <pre class="m-0 whitespace-pre-wrap break-words text-red-400 text-xs">
                {exceptionMsg}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default OutputPanel;
