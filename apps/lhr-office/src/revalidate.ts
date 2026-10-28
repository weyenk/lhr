function siteBaseUrl(): string | null {
  const value = process.env.SITE_BASE_URL?.replace(/\/$/, '');
  return value || null;
}

function isrBypassToken(): string | null {
  return process.env.ISR_BYPASS_TOKEN || null;
}

async function revalidatePath(path: string): Promise<void> {
  const base = siteBaseUrl();
  const token = isrBypassToken();
  if (!base || !token) {
    console.warn('[revalidate] SITE_BASE_URL or ISR_BYPASS_TOKEN unset; skipping', path);
    return;
  }

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-prerender-revalidate': token },
    });
    if (!response.ok) {
      console.warn(`[revalidate] ${url} returned ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[revalidate] failed for ${url}: ${message}`);
  }
}

export async function revalidatePublishedPost(slug: string): Promise<void> {
  await Promise.all([revalidatePath(`/posts/${slug}/`), revalidatePath('/')]);
}
