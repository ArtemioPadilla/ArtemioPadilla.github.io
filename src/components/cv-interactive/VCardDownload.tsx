import type { CVPersonal } from "../../types/cv";

interface Props {
  personal: CVPersonal;
}

export default function VCardDownload({ personal }: Props) {
  const download = () => {
    const vCardContent = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${personal.name.full}`,
      `N:${personal.name.last};${personal.name.first};;;`,
      `TITLE:${personal.title}`,
      `TEL;TYPE=CELL:${personal.contact.phone ?? ""}`,
      `EMAIL:${personal.contact.email}`,
      "URL:https://artemiopadilla.github.io/cv",
      personal.contact.linkedin
        ? `URL;type=LINKEDIN:${personal.contact.linkedin}`
        : "",
      personal.contact.github
        ? `URL;type=GITHUB:${personal.contact.github}`
        : "",
      `NOTE:${personal.summary.brief}`,
      "END:VCARD",
    ]
      .filter(Boolean)
      .join("\r\n");

    const blob = new Blob([vCardContent], {
      type: "text/vcard;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "artemio-padilla.vcf";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <button
      onClick={download}
      title="Download vCard"
      aria-label="Download vCard"
      style={{
        position: "fixed",
        bottom: "100px",
        right: "30px",
        zIndex: 1000,
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        backgroundColor: "#28a745",
        color: "white",
        border: "none",
        boxShadow: "0 4px 12px rgba(40, 167, 69, 0.4)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.3s ease",
        fontSize: "20px",
      }}
    >
      <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10-4h2v2h-2v-2zm-4 0h2v2h-2v-2z" />
      </svg>
    </button>
  );
}
