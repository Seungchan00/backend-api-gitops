import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '3m', target: 300 },
        { duration: '2m', target: 300 },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const res = http.get('http://localhost/', {
    headers: { Host: 'prod.myapp.local' },
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
