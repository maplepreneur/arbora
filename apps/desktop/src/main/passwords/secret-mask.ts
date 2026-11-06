/** Session secrets typed into a page. Replaces them in logs and tool text. Never stores them on disk. */
export class SecretMask {
  private readonly values = new Set<string>();

  note(secret: string): void {
    if (secret.length >= 4) this.values.add(secret);
  }

  list(): readonly string[] {
    return [...this.values];
  }

  apply(text: string): string {
    let out = text;
    for (const secret of this.values) out = out.split(secret).join('•••');
    return out;
  }
}
