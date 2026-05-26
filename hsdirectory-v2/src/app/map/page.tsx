import { redirect } from 'next/navigation';

/**
 * Redirect /map to /services (the map is now the services page).
 */
export default function MapRedirect() {
    redirect('/services');
}
