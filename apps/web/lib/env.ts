const backendOrigin = process.env.NEXT_PUBLIC_API_URL;

if (!backendOrigin) {
  throw new Error(
    "Missing required env NEXT_PUBLIC_API_URL. Set it in your frontend environment (.env.local/.env.production)."
  );
}

// Client should call same-origin /api to avoid CORS in browser.
// Next.js rewrite forwards /api/* to NEXT_PUBLIC_API_URL/api/* server-side.
export const API_URL = "";

