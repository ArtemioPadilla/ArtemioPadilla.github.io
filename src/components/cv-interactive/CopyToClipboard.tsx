import { useState } from "preact/hooks";

interface Props {
  email: string;
  phone?: string;
}

export default function CopyToClipboard({ email, phone }: Props) {
  const [notification, setNotification] = useState<string | null>(null);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setNotification(`${label} copied!`);
    setTimeout(() => setNotification(null), 2000);
  };

  const share = async () => {
    const shareData = {
      title: "Artemio Padilla - CV",
      text: "Check out my professional CV",
      url: window.location.href,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => {});
    } else {
      copy(window.location.href, "CV link");
    }
  };

  const scheduleMeeting = () => {
    window.location.href = `mailto:${email}?subject=Meeting Request&body=Hi Artemio,%0D%0A%0D%0AI would like to schedule a meeting with you.%0D%0A%0D%0ABest regards,`;
  };

  const actions = [
    {
      label: "Copy Email",
      icon: "✉️",
      action: () => copy(email, "Email"),
    },
    ...(phone
      ? [
          {
            label: "Copy Phone",
            icon: "📞",
            action: () => copy(phone, "Phone"),
          },
        ]
      : []),
    { label: "Share CV", icon: "🔗", action: share },
    { label: "Schedule Meeting", icon: "📅", action: scheduleMeeting },
    { label: "Print CV", icon: "🖨️", action: () => window.print() },
  ];

  return (
    <>
      {/* Quick Actions Sidebar */}
      <div
        style={{
          position: "fixed",
          right: "-50px",
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 999,
          transition: "right 0.3s ease",
          background: "white",
          borderRadius: "10px 0 0 10px",
          boxShadow: "-2px 0 10px rgba(0,0,0,0.1)",
          padding: "8px 4px",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.right = "0";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.right = "-50px";
        }}
      >
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.action}
            title={a.label}
            aria-label={a.label}
            style={{
              display: "block",
              width: "44px",
              height: "44px",
              margin: "6px 3px",
              borderRadius: "50%",
              border: "none",
              background: "#f8f9fa",
              cursor: "pointer",
              fontSize: "18px",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#007bff";
              (e.target as HTMLElement).style.transform = "scale(1.1)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#f8f9fa";
              (e.target as HTMLElement).style.transform = "scale(1)";
            }}
          >
            {a.icon}
          </button>
        ))}
      </div>

      {/* Notification toast */}
      {notification && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: "#28a745",
            color: "white",
            padding: "10px 20px",
            borderRadius: "8px",
            zIndex: 10000,
            fontSize: "14px",
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(40, 167, 69, 0.3)",
            animation: "toastIn 0.3s ease",
          }}
        >
          {notification}
        </div>
      )}

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(100px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
