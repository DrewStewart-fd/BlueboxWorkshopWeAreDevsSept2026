import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.TARGET_URL || 'http://shop:8088';
const products = ['aurora-mug', 'signal-notebook', 'orbit-lamp', 'cloud-socks', 'field-bag', 'night-hoodie'];
const saleProducts = ['aurora-mug', 'signal-notebook'];

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '60s',
  thresholds: {
    http_req_failed: ['rate<0.25'],
  },
};

function jsonRequest(method, path, payload, tags) {
  return http.request(method, `${baseUrl}${path}`, payload ? JSON.stringify(payload) : null, {
    headers: { 'Content-Type': 'application/json' },
    tags,
  });
}

export default function () {
  const userId = `loadgen-${__VU}-${__ITER}`;
  const tags = { workload: 'workshop-shop', user_id: userId };

  const catalog = http.get(`${baseUrl}/api/products`, { tags: { ...tags, operation: 'catalog' } });
  check(catalog, { 'catalog responds': response => response.status === 200 });
  const productById = {};
  catalog.json().forEach(product => { productById[product.id] = product; });
  check(catalog, {
    'catalog has two 20% sale products': response => {
      const saleItems = response.json().filter(product => product.isOnSale);
      return saleItems.length === 2 && saleItems.every(product => saleProducts.includes(product.id) && product.discountPercent === 20 && product.priceCents === Math.round(product.originalPriceCents * 0.8));
    },
  });

  products.slice(0, 4).forEach(productId => {
    const add = jsonRequest('POST', `/api/cart?userId=${userId}`, { productId, quantity: 1 }, { ...tags, operation: 'cart_add' });
    check(add, { 'cart accepts item': response => response.status === 200 });
    check(add, {
      'cart uses catalog price': response => response.json().find(item => item.product.id === productId)?.product.priceCents === productById[productId].priceCents,
    });
  });

  const cart = http.get(`${baseUrl}/api/cart?userId=${userId}`, { tags: { ...tags, operation: 'cart_read' } });
  check(cart, { 'cart responds': response => response.status === 200 });

  if (__ITER % 3 === 0) {
    const expectedTotal = cart.json().reduce((total, item) => total + item.product.priceCents * item.quantity, 0);
    const checkout = jsonRequest('POST', `/api/checkout?userId=${userId}`, {
      email: `loadgen-${__VU}@example.com`,
      cardNumber: '4242424242424242',
      shipping: { firstName: 'Load', lastName: 'Generator', address: '1 Workshop Way', city: 'Localhost', postalCode: '8088' },
    }, { ...tags, operation: 'checkout' });
    check(checkout, { 'checkout responds': response => response.status === 200 });
    check(checkout, { 'checkout uses discounted cart total': response => response.json().totalCents === expectedTotal });
  }

  sleep(0.5);
}
