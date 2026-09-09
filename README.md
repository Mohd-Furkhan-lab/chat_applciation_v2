# Thread frontend

A small React client for the FastAPI chat backend. It intentionally stays separate from the backend repository.

## Run locally

1. Start the backend on port `8000`.
2. In this directory, run:

   ```bash
   npm run dev
   ```

3. Open the address Vite prints (normally `http://localhost:5173`).

The development server forwards API calls to `http://localhost:8000`. It also adjusts the backend's local development cookie from `SameSite=None` to `SameSite=Lax` on the way to the browser, so sign-in works locally without altering backend code.

## Deployment

For a separately hosted API, create a `.env` file based on `.env.example`, set `VITE_API_URL` to the API origin, then run `npm run build`. The backend must permit the frontend origin and set authentication cookies appropriate for HTTPS/cross-origin use.
