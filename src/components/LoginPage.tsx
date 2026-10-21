import React, { useState, useRef, useEffect } from 'react';
import { UserRole, USER_ROLES } from '../types';
import { ChevronDown, Eye, EyeOff, Check, Info } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../services/http';
import '../styles/login.css';

export interface LoginPageProps {
  expiredMessage?: string | null;
}

export const LoginPage: React.FC<LoginPageProps> = ({ expiredMessage }) => {
  const { login } = useAuth();
  // Form State
  const [role, setRole] = useState<UserRole>('Student');
  const [isRoleOpen, setIsRoleOpen] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(true);

  // Validation & Feedback State
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modals
  const [showForgotModal, setShowForgotModal] = useState<boolean>(false);

  // Refs for click outside & focus management
  const roleDropdownRef = useRef<HTMLDivElement>(null);
  const roleButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setIsRoleOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation for modals and dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isRoleOpen) setIsRoleOpen(false);
        if (showForgotModal) setShowForgotModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRoleOpen, showForgotModal]);

  // Form Validation
  const validateForm = (): boolean => {
    let isValid = true;
    setEmailError(null);
    setPasswordError(null);
    setRoleError(null);

    // 1. Validate Role
    if (!role || !USER_ROLES.includes(role)) {
      setRoleError('Please select a valid user role.');
      isValid = false;
    }

    // 2. Validate Email
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Email address is required.');
      isValid = false;
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        setEmailError('Please enter a valid email address (e.g., student@kvcet.ac.in).');
        isValid = false;
      }
    }

    // 3. Validate Password
    if (!password) {
      setPasswordError('Please enter your password.');
      isValid = false;
    }

    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;
    setFormError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // The server verifies the password and that the account really has the selected role.
      await login(email.trim(), password, role, rememberMe);
    } catch (err) {
      setFormError(err instanceof ApiError || err instanceof Error ? err.message : 'Sign-in failed.');
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectRole = (newRole: UserRole) => {
    setRole(newRole);
    setRoleError(null);
    setIsRoleOpen(false);
    if (roleButtonRef.current) {
      roleButtonRef.current.focus();
    }
  };

  return (
    <div className="erp-login-viewport">
      <main className="erp-login-card" aria-label="KVCET Hostel ERP Login Portal">
        {/* Header matching exact screenshot */}
        <header className="erp-card-header">
          <h1 className="erp-card-title">KVCET Hostel ERP</h1>
          <p className="erp-card-subtitle">Welcome back</p>
          <div className="erp-card-divider" aria-hidden="true" />
        </header>

        {/* Login Form */}
        <form className="erp-login-form" onSubmit={handleSubmit} noValidate>
          {(formError || expiredMessage) && (
            <div className="erp-error-text" role="alert" style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px', marginBottom: 4 }}>
              {formError || expiredMessage}
            </div>
          )}
          {/* User Role Dropdown */}
          <div className="erp-form-group" ref={roleDropdownRef}>
            <label className="erp-form-label" id="role-select-label">
              User Role
            </label>
            <div className="erp-role-wrapper">
              <button
                ref={roleButtonRef}
                type="button"
                className="erp-role-button"
                aria-haspopup="listbox"
                aria-expanded={isRoleOpen}
                aria-labelledby="role-select-label"
                onClick={() => setIsRoleOpen(prev => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setIsRoleOpen(true);
                  }
                }}
              >
                <span>{role}</span>
                <ChevronDown
                  size={19}
                  strokeWidth={2.6}
                  className={`erp-role-chevron ${isRoleOpen ? 'open' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {isRoleOpen && (
                <ul
                  className="erp-role-menu"
                  role="listbox"
                  aria-labelledby="role-select-label"
                >
                  {USER_ROLES.map((r: UserRole) => {
                    const isSelected = r === role;
                    return (
                      <li
                        key={r}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        className={`erp-role-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleSelectRole(r)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectRole(r);
                          }
                        }}
                      >
                        <span>{r}</span>
                        {isSelected && (
                          <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {roleError && (
              <div className="erp-error-text" role="alert">
                {roleError}
              </div>
            )}
          </div>

          {/* Email Input */}
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="erp-email-input">
              Email
            </label>
            <div className="erp-input-wrapper">
              <input
                id="erp-email-input"
                type="email"
                name="email"
                className={`erp-input ${emailError ? 'has-error' : ''}`}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                autoComplete="username"
                required
              />
            </div>
            {emailError && (
              <div className="erp-error-text" role="alert">
                {emailError}
              </div>
            )}
          </div>

          {/* Password Input */}
          <div className="erp-form-group">
            <label className="erp-form-label" htmlFor="erp-password-input">
              Password
            </label>
            <div className="erp-input-wrapper">
              <input
                id="erp-password-input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                className={`erp-input erp-input-password ${passwordError ? 'has-error' : ''}`}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="erp-eye-btn"
                onClick={() => setShowPassword(prev => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
              >
                {showPassword ? (
                  <EyeOff size={20} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <Eye size={20} strokeWidth={2.2} aria-hidden="true" />
                )}
              </button>
            </div>
            {passwordError && (
              <div className="erp-error-text" role="alert">
                {passwordError}
              </div>
            )}
          </div>

          {/* Remember me & Forgot password? Row */}
          <div className="erp-options-row">
            <label className="erp-remember-label">
              <input
                type="checkbox"
                className="erp-checkbox-hidden"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span
                className={`erp-checkbox-custom ${rememberMe ? 'checked' : 'unchecked'}`}
                aria-hidden="true"
              >
                {rememberMe && <Check size={13} strokeWidth={3} />}
              </span>
              <span>Remember me</span>
            </label>

            <button
              type="button"
              className="erp-forgot-btn"
              onClick={() => setShowForgotModal(true)}
            >
              Forgot password?
            </button>
          </div>

          {/* Sign in Button */}
          <button
            type="submit"
            className="erp-submit-btn"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>

          {/* Biometric Hint */}
          <p className="erp-biometric-hint">
            Select the role your account was registered with. Access is verified by the server.
          </p>
        </form>
      </main>

      {/* Forgot Password Accessible Dialog */}
      {showForgotModal && (
        <div
          className="erp-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-modal-title"
          onClick={() => setShowForgotModal(false)}
        >
          <div
            className="erp-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="erp-modal-icon-badge" aria-hidden="true">
              <Info size={24} strokeWidth={2.4} />
            </div>
            <h2 id="forgot-modal-title" className="erp-modal-title">
              Password Recovery Notice
            </h2>
            <p className="erp-modal-message">
              Password recovery is not configured in this frontend demo.
              {'\n\n'}
              Please contact the KVCET ERP system administration or your hostel warden for credential support.
            </p>
            <button
              type="button"
              className="erp-modal-btn"
              onClick={() => setShowForgotModal(false)}
              autoFocus
            >
              Understood
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginPage;
