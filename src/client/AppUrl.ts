/** Build a URL inside the app's configured Vite base path. */
export function buildAppUrl(
  path = "",
  baseUrl = import.meta.env.BASE_URL,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}

export function appUrl(path = ""): string {
  return buildAppUrl(path);
}
