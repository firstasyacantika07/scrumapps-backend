import axios from 'axios';

// Sesuaikan URL dengan backend kamu (misal port 5000)
const API_URL = 'http://localhost:5000/api/users';

export const getUsers = () => {
  return axios.get(API_URL);
};

export const createUser = (userData) => {
  return axios.post(API_URL, userData);
};

export const deleteUser = (id) => {
  return axios.delete(`${API_URL}/${id}`);
};