// client/src/utils/auth.js
export function setToken(token) {
  sessionStorage.setItem('token', token);
}
export function getToken() {
  return sessionStorage.getItem('token');
}
export function clearToken() {
  sessionStorage.removeItem('token');
}
export function isLoggedIn() {
  return !!getToken();
}
