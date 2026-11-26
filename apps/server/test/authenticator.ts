// A software passkey for tests: produces WebAuthn JSON responses ("none" attestation, ES256).

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// Minimal CBOR encoder covering what attestation objects and COSE keys need.
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function cborHead(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
  return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
}
function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(cborHead(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(cborHead(2, value.length), value);
  return concat(cborHead(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
}

/** WebCrypto returns ECDSA signatures as r||s; WebAuthn wants DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const trimmed = b.slice(i);
    const v = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export class SoftAuthenticator {
  private counter = 0;
  private keys!: CryptoKeyPair;
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private userHandle = "";

  constructor(
    private rpId: string,
    private origin: string,
  ) {}

  async create(options: { challenge: string; user: { id: string } }) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    this.userHandle = options.user.id;
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = cbor(
      new Map<number, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x ?? "")],
        [-3, fromB64url(jwk.y ?? "")],
      ]),
    );
    const idLength = new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    const authData = concat(
      await sha256(new TextEncoder().encode(this.rpId)),
      new Uint8Array([0x45]), // UP | UV | AT
      new Uint8Array(4),
      new Uint8Array(16),
      idLength,
      this.credentialId,
      cose,
    );
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    const clientData = json({ type: "webauthn.create", challenge: options.challenge, origin: this.origin });
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  async get(options: { challenge: string }) {
    this.counter++;
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.counter);
    const authData = concat(await sha256(new TextEncoder().encode(this.rpId)), new Uint8Array([0x05]), counter);
    const clientData = json({ type: "webauthn.get", challenge: options.challenge, origin: this.origin });
    const signed = concat(authData, await sha256(clientData));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed),
    );
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(derSignature(raw)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }
}
