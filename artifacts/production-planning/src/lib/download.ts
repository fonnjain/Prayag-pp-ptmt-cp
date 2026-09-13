export async function downloadFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail = text;
    try {
      const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
      detail = typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : text;
    } catch {
      // Keep the raw response when the server did not return JSON.
    }
    throw new Error(detail || `Export failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  const disposition = response.headers.get("content-disposition");
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  link.download = encodedName ? decodeURIComponent(encodedName) : plainName ?? filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
