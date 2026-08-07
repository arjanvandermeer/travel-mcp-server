/**
 * Obfuscate email for logs and telemetry.
 * Example: "arjanvdm@gmail.com" -> "a...m@gm...om"
 */
export function obfuscateEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const localObf = local.length <= 2 ? `${local[0]}*` : `${local[0]}...${local[local.length - 1]}`;
  const domainObf = domain.length <= 4 ? domain : `${domain.slice(0, 2)}...${domain.slice(-2)}`;
  return `${localObf}@${domainObf}`;
}
