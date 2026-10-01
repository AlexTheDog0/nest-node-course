// The imagined frontend's HTTP boundary, exercised against Pact's mock server.
export async function getProduct(baseUrl, id) {
  const response = await fetch(`${baseUrl}/products/${id}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Catalog returned HTTP ${response.status}`);
  return response.json();
}
