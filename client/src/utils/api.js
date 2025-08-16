// client/src/utils/api.js
import axios from 'axios';
import { getToken, clearToken } from './auth';

const isProd = process.env.REACT_APP_NODE_ENV === 'production';

const API_BASE =
  (isProd && process.env.REACT_APP_BACKEND_URL) ||
  (isProd && `${window.location.origin}/api`) ||
  '/api';

console.log('🛰️  API_BASE =', API_BASE);

const api = axios.create({
  baseURL: API_BASE,
  timeout: 10_000,
});

// Request interceptor: attach token
api.interceptors.request.use(
  config => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => Promise.reject(error)
);


export default api;
