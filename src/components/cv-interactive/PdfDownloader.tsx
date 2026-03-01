import { useState } from "preact/hooks";
import type { CVData, PDFFormat } from "../../types/cv";

interface Props {
  cvData: CVData;
}

const formats: { key: PDFFormat; label: string; detail: string; icon: string }[] = [
  { key: "full", label: "Full CV", detail: "Complete with all details", icon: "📄" },
  { key: "resume", label: "2-Page Resume", detail: "Resume highlights", icon: "📋" },
  { key: "summary", label: "1-Page Resume", detail: "Executive summary", icon: "📝" },
];

export default function PdfDownloader({ cvData }: Props) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState<PDFFormat | null>(null);

  const handleGenerate = async (format: PDFFormat) => {
    setGenerating(format);
    setOpen(false);
    try {
      const { generatePDF } = await import("../../utils/pdf-generator");
      await generatePDF(cvData, format);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("PDF generation failed. Please try again.");
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "30px", right: "30px", zIndex: 1000 }}>
      {/* Dropdown menu */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "70px",
            right: "0",
            background: "white",
            minWidth: "220px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            borderRadius: "12px",
            overflow: "hidden",
            animation: "slideUp 0.2s ease",
          }}
        >
          {formats.map((f) => (
            <button
              key={f.key}
              onClick={() => handleGenerate(f.key)}
              disabled={generating !== null}
              style={{
                display: "block",
                width: "100%",
                padding: "12px 16px",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                background: "white",
                cursor: generating ? "wait" : "pointer",
                textAlign: "left",
                fontSize: "14px",
                color: "#333",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = "#f8f9fa";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = "white";
              }}
            >
              <span style={{ marginRight: "8px" }}>{f.icon}</span>
              <strong>{f.label}</strong>
              <br />
              <small style={{ color: "#6c757d", marginLeft: "26px" }}>{f.detail}</small>
            </button>
          ))}
        </div>
      )}

      {/* Main floating button */}
      <button
        onClick={() => setOpen(!open)}
        disabled={generating !== null}
        aria-label="Download PDF options"
        style={{
          width: "60px",
          height: "60px",
          borderRadius: "50%",
          backgroundColor: generating ? "#6c757d" : "#007bff",
          color: "white",
          border: "none",
          boxShadow: "0 4px 12px rgba(0, 123, 255, 0.4)",
          cursor: generating ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.3s ease",
          fontSize: "24px",
        }}
      >
        {generating ? (
          <span
            style={{
              display: "inline-block",
              width: "24px",
              height: "24px",
              border: "3px solid rgba(255,255,255,0.3)",
              borderTopColor: "white",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
        ) : (
          <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
            <path d="M12 18l4-4h-3V9h-2v5H8l4 4z" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
