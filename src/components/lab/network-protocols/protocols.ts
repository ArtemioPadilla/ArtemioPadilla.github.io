/* ══════════════════════════════════════════════════════════
   Protocol Definitions — Pure data, zero browser APIs
   ══════════════════════════════════════════════════════════ */

/* ── Types ─────────────────────────────────────────────── */

export type OsiLayer =
  | "Application"
  | "Presentation"
  | "Session"
  | "Transport"
  | "Network"
  | "Data Link"
  | "Physical";

export interface PacketHeader {
  layer: OsiLayer;
  fields: Record<string, string>;
}

export interface Endpoint {
  id: string;
  label: string;
  x: number; // 0..1 normalized
}

export interface Arrow {
  from: string;
  to: string;
  label: string;
  sublabel?: string;
  color: string;
  dashed?: boolean;
  lost?: boolean; // for UDP lost packets
}

export interface ProtocolStep {
  description: string;
  activeOsiLayers: OsiLayer[];
  arrows: Arrow[];
  packetHeaders: PacketHeader[];
}

export interface ProtocolDefinition {
  id: string;
  name: string;
  shortName: string;
  endpoints: Endpoint[];
  steps: ProtocolStep[];
}

/* ── Color Palette ─────────────────────────────────────── */

const COLORS = {
  app: "#34d399",      // green — Application layer
  transport: "#4f8ff7", // blue — Transport layer
  network: "#f97316",   // orange — Network layer
  tls: "#a855f7",       // purple — TLS/Security
  dns: "#fbbf24",       // yellow — DNS
  lost: "#ef4444",      // red — lost/error
  ack: "#06b6d4",       // cyan — acknowledgments
};

/* ── OSI Layers (top to bottom) ────────────────────────── */

export const OSI_LAYERS: OsiLayer[] = [
  "Application",
  "Presentation",
  "Session",
  "Transport",
  "Network",
  "Data Link",
  "Physical",
];

export const OSI_LAYER_COLORS: Record<OsiLayer, string> = {
  Application: "#34d399",
  Presentation: "#a855f7",
  Session: "#ec4899",
  Transport: "#4f8ff7",
  Network: "#f97316",
  "Data Link": "#fbbf24",
  Physical: "#6366f1",
};

/* ══════════════════════════════════════════════════════════
   Protocol: TCP 3-Way Handshake
   ══════════════════════════════════════════════════════════ */

const tcpHandshake: ProtocolDefinition = {
  id: "tcp",
  name: "TCP 3-Way Handshake",
  shortName: "TCP",
  endpoints: [
    { id: "client", label: "Client", x: 0.25 },
    { id: "server", label: "Server", x: 0.75 },
  ],
  steps: [
    {
      description:
        "Client initiates connection by sending a SYN segment with an initial sequence number (ISN).",
      activeOsiLayers: ["Transport", "Network", "Data Link", "Physical"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "SYN",
          sublabel: "seq=100, win=65535",
          color: COLORS.transport,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "Source Port": "49152",
            "Dest Port": "80",
            "Seq Number": "100",
            "Ack Number": "0",
            Flags: "SYN",
            "Window Size": "65535",
            Checksum: "0x7f3a",
          },
        },
        {
          layer: "Network",
          fields: {
            "Source IP": "192.168.1.10",
            "Dest IP": "93.184.216.34",
            TTL: "64",
            Protocol: "TCP (6)",
          },
        },
      ],
    },
    {
      description:
        "Server acknowledges with SYN-ACK, sending its own ISN and acknowledging the client's sequence number.",
      activeOsiLayers: ["Transport", "Network", "Data Link", "Physical"],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "SYN-ACK",
          sublabel: "seq=300, ack=101, win=65535",
          color: COLORS.transport,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "Source Port": "80",
            "Dest Port": "49152",
            "Seq Number": "300",
            "Ack Number": "101",
            Flags: "SYN, ACK",
            "Window Size": "65535",
            Checksum: "0xa2c1",
          },
        },
        {
          layer: "Network",
          fields: {
            "Source IP": "93.184.216.34",
            "Dest IP": "192.168.1.10",
            TTL: "56",
            Protocol: "TCP (6)",
          },
        },
      ],
    },
    {
      description:
        "Client completes the handshake by sending an ACK. The connection is now ESTABLISHED.",
      activeOsiLayers: ["Transport", "Network", "Data Link", "Physical"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "ACK",
          sublabel: "seq=101, ack=301",
          color: COLORS.ack,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "Source Port": "49152",
            "Dest Port": "80",
            "Seq Number": "101",
            "Ack Number": "301",
            Flags: "ACK",
            "Window Size": "65535",
            Checksum: "0xb4f2",
          },
        },
        {
          layer: "Network",
          fields: {
            "Source IP": "192.168.1.10",
            "Dest IP": "93.184.216.34",
            TTL: "64",
            Protocol: "TCP (6)",
          },
        },
      ],
    },
    {
      description:
        "Connection established. Both sides can now send data. State: ESTABLISHED on both endpoints.",
      activeOsiLayers: ["Transport"],
      arrows: [],
      packetHeaders: [],
    },
  ],
};

/* ══════════════════════════════════════════════════════════
   Protocol: HTTP Request/Response
   ══════════════════════════════════════════════════════════ */

const httpFlow: ProtocolDefinition = {
  id: "http",
  name: "HTTP Request/Response",
  shortName: "HTTP",
  endpoints: [
    { id: "client", label: "Client", x: 0.2 },
    { id: "dns", label: "DNS Resolver", x: 0.5 },
    { id: "server", label: "Web Server", x: 0.8 },
  ],
  steps: [
    {
      description:
        "Client resolves the domain name by querying the DNS resolver.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "client",
          to: "dns",
          label: "DNS Query",
          sublabel: "A example.com",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Query",
            "Query Name": "example.com",
            "Query Type": "A (IPv4)",
            "Transaction ID": "0x1a2b",
          },
        },
        {
          layer: "Transport",
          fields: {
            Protocol: "UDP",
            "Source Port": "54321",
            "Dest Port": "53",
          },
        },
      ],
    },
    {
      description:
        "DNS resolver returns the IP address for the requested domain.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "dns",
          to: "client",
          label: "DNS Response",
          sublabel: "93.184.216.34",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Response",
            Answer: "93.184.216.34",
            TTL: "3600",
            "Transaction ID": "0x1a2b",
          },
        },
      ],
    },
    {
      description:
        "Client establishes a TCP connection to the server (3-way handshake condensed).",
      activeOsiLayers: ["Transport", "Network"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "TCP SYN",
          color: COLORS.transport,
        },
        {
          from: "server",
          to: "client",
          label: "TCP SYN-ACK",
          color: COLORS.transport,
        },
        {
          from: "client",
          to: "server",
          label: "TCP ACK",
          color: COLORS.ack,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            Flags: "SYN -> SYN-ACK -> ACK",
            "Seq Numbers": "100 -> 300 -> 101",
            Note: "3-way handshake (condensed)",
          },
        },
      ],
    },
    {
      description:
        "Client sends HTTP GET request with headers to the web server.",
      activeOsiLayers: [
        "Application",
        "Presentation",
        "Session",
        "Transport",
        "Network",
      ],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "HTTP GET /",
          sublabel: "Host: example.com",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Method: "GET",
            Path: "/",
            Version: "HTTP/1.1",
            Host: "example.com",
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
            Connection: "keep-alive",
          },
        },
        {
          layer: "Transport",
          fields: {
            "Source Port": "49152",
            "Dest Port": "80",
            Flags: "PSH, ACK",
          },
        },
      ],
    },
    {
      description:
        "Server processes the request and sends back an HTTP response with status, headers, and body.",
      activeOsiLayers: [
        "Application",
        "Presentation",
        "Session",
        "Transport",
        "Network",
      ],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "HTTP 200 OK",
          sublabel: "text/html, 1256 bytes",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Status: "200 OK",
            "Content-Type": "text/html; charset=UTF-8",
            "Content-Length": "1256",
            Server: "nginx/1.25",
            "Cache-Control": "max-age=604800",
            Body: "<!DOCTYPE html>...",
          },
        },
        {
          layer: "Transport",
          fields: {
            "Source Port": "80",
            "Dest Port": "49152",
            Flags: "PSH, ACK",
          },
        },
      ],
    },
    {
      description:
        "Client initiates TCP connection teardown with FIN. Server acknowledges and closes.",
      activeOsiLayers: ["Transport", "Network"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "FIN",
          color: COLORS.transport,
        },
        {
          from: "server",
          to: "client",
          label: "FIN-ACK",
          color: COLORS.transport,
        },
        {
          from: "client",
          to: "server",
          label: "ACK",
          color: COLORS.ack,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            Flags: "FIN -> FIN-ACK -> ACK",
            Note: "TCP connection teardown (4-way close)",
          },
        },
      ],
    },
  ],
};

/* ══════════════════════════════════════════════════════════
   Protocol: DNS Resolution
   ══════════════════════════════════════════════════════════ */

const dnsResolution: ProtocolDefinition = {
  id: "dns",
  name: "DNS Recursive Resolution",
  shortName: "DNS",
  endpoints: [
    { id: "client", label: "Client", x: 0.1 },
    { id: "recursive", label: "Recursive\nResolver", x: 0.325 },
    { id: "root", label: "Root\nServer", x: 0.55 },
    { id: "tld", label: "TLD\nServer (.com)", x: 0.775 },
    { id: "auth", label: "Authoritative\nServer", x: 0.95 },
  ],
  steps: [
    {
      description:
        "Client sends a DNS query to its configured recursive resolver (e.g., 8.8.8.8).",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "client",
          to: "recursive",
          label: "Query",
          sublabel: "www.example.com?",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Query (Recursive)",
            "Query Name": "www.example.com",
            "Query Type": "A",
            Flags: "RD=1 (Recursion Desired)",
          },
        },
        {
          layer: "Transport",
          fields: { Protocol: "UDP", "Dest Port": "53" },
        },
      ],
    },
    {
      description:
        "Recursive resolver queries one of the 13 root name servers for the .com TLD.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "recursive",
          to: "root",
          label: "Query",
          sublabel: "www.example.com?",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Query (Iterative)",
            "Query Name": "www.example.com",
            "Server": "a.root-servers.net (198.41.0.4)",
          },
        },
      ],
    },
    {
      description:
        "Root server responds with a referral to the .com TLD name servers.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "root",
          to: "recursive",
          label: "Referral",
          sublabel: "Try .com NS: a.gtld-servers.net",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Referral",
            Authority: "com. NS a.gtld-servers.net",
            Additional: "a.gtld-servers.net A 192.5.6.30",
          },
        },
      ],
    },
    {
      description:
        "Recursive resolver queries the .com TLD server for example.com.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "recursive",
          to: "tld",
          label: "Query",
          sublabel: "www.example.com?",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Query (Iterative)",
            "Query Name": "www.example.com",
            Server: "a.gtld-servers.net (192.5.6.30)",
          },
        },
      ],
    },
    {
      description:
        "TLD server responds with a referral to example.com's authoritative name servers.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "tld",
          to: "recursive",
          label: "Referral",
          sublabel: "Try NS: ns1.example.com",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Referral",
            Authority: "example.com. NS ns1.example.com",
            Additional: "ns1.example.com A 93.184.216.1",
          },
        },
      ],
    },
    {
      description:
        "Recursive resolver queries the authoritative server for the final answer.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "recursive",
          to: "auth",
          label: "Query",
          sublabel: "www.example.com?",
          color: COLORS.dns,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Query (Iterative)",
            "Query Name": "www.example.com",
            Server: "ns1.example.com (93.184.216.1)",
          },
        },
      ],
    },
    {
      description:
        "Authoritative server returns the definitive IP address for the domain.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "auth",
          to: "recursive",
          label: "Answer",
          sublabel: "93.184.216.34, TTL=3600",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Answer (Authoritative)",
            Answer: "www.example.com A 93.184.216.34",
            TTL: "3600",
            Flags: "AA=1 (Authoritative)",
          },
        },
      ],
    },
    {
      description:
        "Recursive resolver caches the result and returns it to the client.",
      activeOsiLayers: ["Application", "Transport", "Network"],
      arrows: [
        {
          from: "recursive",
          to: "client",
          label: "Answer",
          sublabel: "93.184.216.34",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            Type: "DNS Answer (Cached)",
            Answer: "www.example.com A 93.184.216.34",
            TTL: "3600",
            Flags: "RA=1 (Recursion Available)",
            Note: "Result cached for future queries",
          },
        },
      ],
    },
  ],
};

/* ══════════════════════════════════════════════════════════
   Protocol: TLS Handshake
   ══════════════════════════════════════════════════════════ */

const tlsHandshake: ProtocolDefinition = {
  id: "tls",
  name: "TLS 1.3 Handshake",
  shortName: "TLS",
  endpoints: [
    { id: "client", label: "Client", x: 0.25 },
    { id: "server", label: "Server", x: 0.75 },
  ],
  steps: [
    {
      description:
        "Client sends ClientHello with supported cipher suites, TLS version, and a random value.",
      activeOsiLayers: [
        "Presentation",
        "Session",
        "Transport",
        "Network",
      ],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "ClientHello",
          sublabel: "TLS 1.3, cipher suites, key_share",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            Version: "TLS 1.3",
            "Cipher Suites":
              "TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256",
            Extensions: "key_share, supported_versions, signature_algorithms",
            "Client Random": "0x7f3a...b2c1 (32 bytes)",
          },
        },
        {
          layer: "Transport",
          fields: {
            "Source Port": "49152",
            "Dest Port": "443",
            Flags: "PSH, ACK",
          },
        },
      ],
    },
    {
      description:
        "Server selects cipher suite and sends ServerHello with its key share.",
      activeOsiLayers: [
        "Presentation",
        "Session",
        "Transport",
        "Network",
      ],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "ServerHello",
          sublabel: "Selected: AES_256_GCM_SHA384",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            "Selected Cipher": "TLS_AES_256_GCM_SHA384",
            "Key Share": "x25519 public key",
            "Server Random": "0xa1b2...d3e4 (32 bytes)",
          },
        },
      ],
    },
    {
      description:
        "Server sends its certificate chain for the client to verify the server's identity.",
      activeOsiLayers: ["Presentation", "Session"],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "Certificate",
          sublabel: "X.509 cert chain",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            "Certificate Subject": "CN=example.com",
            Issuer: "Let's Encrypt Authority X3",
            Validity: "2026-01-01 to 2026-12-31",
            "Key Type": "ECDSA P-256",
            "Chain Length": "2 certificates",
          },
        },
      ],
    },
    {
      description:
        "Server sends CertificateVerify proving it owns the private key for the certificate.",
      activeOsiLayers: ["Presentation", "Session"],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "CertificateVerify",
          sublabel: "Signature over handshake",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            Algorithm: "ecdsa_secp256r1_sha256",
            Signature: "0x30...ff (72 bytes)",
            "Signed Data": "Hash of all handshake messages so far",
          },
        },
      ],
    },
    {
      description:
        "Server sends Finished message with a MAC over the entire handshake transcript.",
      activeOsiLayers: ["Presentation", "Session"],
      arrows: [
        {
          from: "server",
          to: "client",
          label: "Finished",
          sublabel: "Verify handshake integrity",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            "Verify Data": "HMAC-SHA384 of handshake transcript",
            Note: "All subsequent server data is encrypted",
          },
        },
      ],
    },
    {
      description:
        "Client verifies the certificate, computes shared secret, and sends its Finished message.",
      activeOsiLayers: ["Presentation", "Session"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "Finished",
          sublabel: "Handshake complete",
          color: COLORS.tls,
        },
      ],
      packetHeaders: [
        {
          layer: "Presentation",
          fields: {
            "Content Type": "Handshake (22)",
            "Verify Data": "HMAC-SHA384 of handshake transcript",
            "Shared Secret": "Derived via ECDHE (x25519)",
            Note: "All subsequent data is encrypted with AES-256-GCM",
          },
        },
      ],
    },
    {
      description:
        "Secure channel established. Application data is now encrypted with the negotiated cipher.",
      activeOsiLayers: ["Application", "Presentation", "Session"],
      arrows: [
        {
          from: "client",
          to: "server",
          label: "Application Data",
          sublabel: "Encrypted with AES-256-GCM",
          color: COLORS.app,
          dashed: false,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            "Content Type": "Application Data (23)",
            Cipher: "AES-256-GCM",
            Note: "Payload is fully encrypted",
          },
        },
      ],
    },
  ],
};

/* ══════════════════════════════════════════════════════════
   Protocol: UDP vs TCP Comparison
   ══════════════════════════════════════════════════════════ */

const udpVsTcp: ProtocolDefinition = {
  id: "udp-tcp",
  name: "UDP vs TCP Comparison",
  shortName: "UDP/TCP",
  endpoints: [
    { id: "tcp-client", label: "TCP\nClient", x: 0.08 },
    { id: "tcp-server", label: "TCP\nServer", x: 0.38 },
    { id: "udp-client", label: "UDP\nClient", x: 0.62 },
    { id: "udp-server", label: "UDP\nServer", x: 0.92 },
  ],
  steps: [
    {
      description:
        "TCP side: Connection requires a 3-way handshake before data transfer. UDP: No connection setup needed.",
      activeOsiLayers: ["Transport", "Network"],
      arrows: [
        {
          from: "tcp-client",
          to: "tcp-server",
          label: "SYN",
          color: COLORS.transport,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP Header Size": "20-60 bytes",
            "UDP Header Size": "8 bytes",
            "TCP State": "SYN_SENT",
            Note: "TCP requires handshake; UDP does not",
          },
        },
      ],
    },
    {
      description: "TCP: Server responds with SYN-ACK. UDP: No equivalent step.",
      activeOsiLayers: ["Transport", "Network"],
      arrows: [
        {
          from: "tcp-server",
          to: "tcp-client",
          label: "SYN-ACK",
          color: COLORS.transport,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP State": "SYN_RECEIVED",
            "Connection": "Being established",
          },
        },
      ],
    },
    {
      description: "TCP: Client completes handshake. Connection established.",
      activeOsiLayers: ["Transport"],
      arrows: [
        {
          from: "tcp-client",
          to: "tcp-server",
          label: "ACK",
          color: COLORS.ack,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP State": "ESTABLISHED",
            "Overhead": "3 packets before any data",
          },
        },
      ],
    },
    {
      description:
        "Both send data. TCP: Reliable, ordered delivery with sequence numbers. UDP: Fire-and-forget datagrams.",
      activeOsiLayers: ["Application", "Transport"],
      arrows: [
        {
          from: "tcp-client",
          to: "tcp-server",
          label: "Data (seq=1)",
          sublabel: "Reliable, ordered",
          color: COLORS.app,
        },
        {
          from: "udp-client",
          to: "udp-server",
          label: "Datagram 1",
          sublabel: "Fire and forget",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Application",
          fields: {
            "TCP Guarantee": "Ordered, reliable delivery",
            "UDP Guarantee": "None - best effort only",
          },
        },
        {
          layer: "Transport",
          fields: {
            "TCP Seq": "1",
            "TCP Ack expected": "Yes",
            "UDP Seq": "N/A",
            "UDP Ack": "N/A",
          },
        },
      ],
    },
    {
      description:
        "TCP: Server acknowledges received data. UDP: No acknowledgment, no way to know if data arrived.",
      activeOsiLayers: ["Transport"],
      arrows: [
        {
          from: "tcp-server",
          to: "tcp-client",
          label: "ACK (ack=2)",
          sublabel: "Confirmed receipt",
          color: COLORS.ack,
        },
        {
          from: "udp-client",
          to: "udp-server",
          label: "Datagram 2",
          sublabel: "No confirmation",
          color: COLORS.app,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP": "ACK confirms delivery",
            "UDP": "Sender has no idea if packet arrived",
          },
        },
      ],
    },
    {
      description:
        "Packet loss scenario: TCP detects and retransmits. UDP loses the data permanently.",
      activeOsiLayers: ["Transport", "Network"],
      arrows: [
        {
          from: "tcp-client",
          to: "tcp-server",
          label: "Data (seq=2)",
          sublabel: "Retransmitted",
          color: COLORS.transport,
        },
        {
          from: "udp-client",
          to: "udp-server",
          label: "Datagram 3",
          sublabel: "LOST!",
          color: COLORS.lost,
          lost: true,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP Behavior": "Timeout -> Retransmit (guaranteed delivery)",
            "UDP Behavior": "Packet lost forever (no retransmission)",
            "TCP Use Case": "Web, Email, File Transfer",
            "UDP Use Case": "Video streaming, Gaming, DNS queries",
          },
        },
      ],
    },
    {
      description:
        "TCP: Graceful close with FIN/ACK. UDP: Simply stop sending. No connection to close.",
      activeOsiLayers: ["Transport"],
      arrows: [
        {
          from: "tcp-client",
          to: "tcp-server",
          label: "FIN",
          color: COLORS.transport,
        },
        {
          from: "tcp-server",
          to: "tcp-client",
          label: "FIN-ACK",
          color: COLORS.transport,
        },
      ],
      packetHeaders: [
        {
          layer: "Transport",
          fields: {
            "TCP": "Graceful connection teardown",
            "UDP": "Just stop sending - no close needed",
            "TCP Overhead": "Higher (headers, handshake, acks)",
            "UDP Overhead": "Minimal (8-byte header only)",
          },
        },
      ],
    },
  ],
};

/* ══════════════════════════════════════════════════════════
   Exports
   ══════════════════════════════════════════════════════════ */

export const ALL_PROTOCOLS: ProtocolDefinition[] = [
  tcpHandshake,
  httpFlow,
  dnsResolution,
  tlsHandshake,
  udpVsTcp,
];
