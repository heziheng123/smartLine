import { useEffect, useState } from 'react';

/**
 * Phone-only presentation boundary.
 *
 * A 600px-wide tablet keeps the existing application layout. The short-side
 * clause keeps a coarse-pointer phone in the phone UI after rotating to
 * landscape without affecting normal tablet viewports.
 */
export const PHONE_LAYOUT_QUERY = '(max-width: 599px), (max-height: 599px) and (pointer: coarse)';

export function isPhoneLayoutViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_LAYOUT_QUERY).matches;
}

export function usePhoneLayout(): boolean {
  const [matches, setMatches] = useState(isPhoneLayoutViewport);

  useEffect(() => {
    const media = window.matchMedia(PHONE_LAYOUT_QUERY);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return matches;
}
