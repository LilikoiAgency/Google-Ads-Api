import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPlaces, getPlace, resolveLocationInput, matchesDomain, PlacesError } from '@/lib/seoAuditV2/places';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });

describe('places client', () => {
  beforeEach(() => {
    process.env.PLACES_API_KEY = 'test-key';
    global.fetch = vi.fn();
  });
  afterEach(() => {
    delete process.env.PLACES_API_KEY;
  });

  it('missing key is not_connected', async () => {
    delete process.env.PLACES_API_KEY;
    await expect(searchPlaces('x')).rejects.toMatchObject({ name: 'PlacesError', code: 'not_connected' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps 403 to permission and other failures to error', async () => {
    global.fetch.mockResolvedValueOnce(json({}, 403));
    await expect(searchPlaces('x')).rejects.toMatchObject({ code: 'permission' });
    global.fetch.mockResolvedValueOnce(json({}, 500));
    await expect(searchPlaces('x')).rejects.toBeInstanceOf(PlacesError);
    global.fetch.mockRejectedValueOnce(new Error('boom'));
    await expect(searchPlaces('x')).rejects.toMatchObject({ code: 'error' });
  });

  it('searchPlaces sends the field mask and maps fields', async () => {
    global.fetch.mockResolvedValueOnce(json({
      places: [{
        id: 'ChIJabc',
        displayName: { text: 'Ranger Electric Company', languageCode: 'en' },
        formattedAddress: '4115 Garden Ln, Tampa, FL 33610, USA',
        websiteUri: 'https://rangerelectricco.com/',
      }],
    }));
    const out = await searchPlaces('Ranger Electric Tampa', { bias: { lat: 27.9, lng: -82.4 } });
    expect(out).toEqual([{
      id: 'ChIJabc', name: 'Ranger Electric Company', address: '4115 Garden Ln, Tampa, FL 33610, USA',
      website: 'https://rangerelectricco.com/', rating: null, count: null, mapsUrl: null,
    }]);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(opts.headers['X-Goog-FieldMask']).toBe(
      'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri'
    );
    const body = JSON.parse(opts.body);
    expect(body.textQuery).toBe('Ranger Electric Tampa');
    expect(body.locationBias).toEqual({ circle: { center: { latitude: 27.9, longitude: -82.4 }, radius: 5000 } });
  });

  it('searchPlaces returns [] when nothing matches', async () => {
    global.fetch.mockResolvedValueOnce(json({}));
    expect(await searchPlaces('nothing')).toEqual([]);
  });

  it('getPlace maps reviews and city', async () => {
    global.fetch.mockResolvedValueOnce(json({
      id: 'ChIJabc',
      displayName: { text: 'Ranger' },
      formattedAddress: '4115 Garden Ln, Tampa, FL',
      websiteUri: 'https://rangerelectricco.com/',
      rating: 4.8,
      userRatingCount: 120,
      googleMapsUri: 'https://maps.google.com/?cid=1',
      addressComponents: [
        { longText: 'Tampa', shortText: 'Tampa', types: ['locality', 'political'] },
        { longText: 'Florida', shortText: 'FL', types: ['administrative_area_level_1', 'political'] },
      ],
      reviews: [
        { rating: 5, publishTime: '2026-03-04T10:00:00Z', text: { text: 'Great' } },
        { rating: 2, publishTime: '2026-02-01T10:00:00Z', originalText: { text: 'Late' } },
      ],
    }));
    const p = await getPlace('ChIJabc');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc');
    expect(opts.headers['X-Goog-FieldMask']).toBe(
      'id,displayName,formattedAddress,websiteUri,rating,userRatingCount,googleMapsUri,addressComponents,reviews'
    );
    expect(p).toMatchObject({ id: 'ChIJabc', name: 'Ranger', rating: 4.8, count: 120, city: 'Tampa', region: 'FL', mapsUrl: 'https://maps.google.com/?cid=1' });
    expect(p.reviews).toEqual([
      { stars: 5, date: '2026-03-04', text: 'Great' },
      { stars: 2, date: '2026-02-01', text: 'Late' },
    ]);
  });

  it('resolves a short Maps link via its redirect', async () => {
    global.fetch
      .mockResolvedValueOnce({ status: 302, ok: false, headers: new Headers({ location: 'https://www.google.com/maps/place/Ranger+Electric/@27.9,-82.4,17z/data=x' }) })
      .mockResolvedValueOnce(json({ places: [{ id: 'P1', displayName: { text: 'Ranger Electric' } }] }));
    const out = await resolveLocationInput('https://maps.app.goo.gl/abc123');
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    const body = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(body.textQuery).toBe('Ranger Electric');
    expect(body.locationBias.circle.center).toEqual({ latitude: 27.9, longitude: -82.4 });
    expect(out.map((p) => p.id)).toEqual(['P1']);
  });

  it('falls back to text search when a short link has no location header', async () => {
    global.fetch
      .mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers() })
      .mockResolvedValueOnce(json({ places: [] }));
    await resolveLocationInput('https://maps.app.goo.gl/zzz');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).textQuery).toBe('https://maps.app.goo.gl/zzz');
  });

  it('resolves a place_id link without searching', async () => {
    global.fetch.mockResolvedValueOnce(json({ id: 'ChIJxyz', displayName: { text: 'X' }, reviews: [] }));
    const out = await resolveLocationInput('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJxyz');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://places.googleapis.com/v1/places/ChIJxyz');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ChIJxyz');
  });

  it('plain text searches and caps at 5', async () => {
    const places = Array.from({ length: 8 }, (_, i) => ({ id: `P${i}`, displayName: { text: `N${i}` } }));
    global.fetch.mockResolvedValueOnce(json({ places }));
    const out = await resolveLocationInput('  plumber tampa ');
    expect(out).toHaveLength(5);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).textQuery).toBe('plumber tampa');
  });
});

describe('matchesDomain', () => {
  it('ignores www and trailing slash', () => {
    expect(matchesDomain('https://www.rangerelectricco.com/', 'rangerelectricco.com')).toBe(true);
    expect(matchesDomain('http://rangerelectricco.com', 'www.rangerelectricco.com/')).toBe(true);
    expect(matchesDomain('https://other.com/', 'rangerelectricco.com')).toBe(false);
    expect(matchesDomain(null, 'x.com')).toBe(false);
  });
});
