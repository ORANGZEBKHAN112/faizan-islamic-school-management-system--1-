import axios from 'axios';
import {
  User,
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  LoginResult,
} from '../types';

const API_URL = '/api/auth';

export const authService = {
  async login(data: LoginRequest): Promise<LoginResult> {
    const response = await axios.post(`${API_URL}/login`, data);
    return response.data;
  },

  async verifyLoginOtp(data: { challengeId: string; code: string }): Promise<AuthResponse> {
    const response = await axios.post(`${API_URL}/verify-login-otp`, data);
    return response.data;
  },

  async resendLoginOtp(data: { challengeId: string }): Promise<{ ok: boolean; message?: string }> {
    const response = await axios.post(`${API_URL}/resend-login-otp`, data);
    return response.data;
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await axios.post(`${API_URL}/register`, data);
    return response.data;
  },

  async getCurrentUser(username: string): Promise<User> {
    const response = await axios.get(`${API_URL}/me/${username}`);
    return response.data;
  }
};
