import { Request, Response, NextFunction } from 'express'
import { UserRole } from '../types/user.js'
import { getVerifierProfile } from '../services/verifiers.js'

type RBACOptions = {
  allow: UserRole[];
};

const logRBACDenied = (req: Request, reason: string) => {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "security.rbac_denied",
      service: "disciplr-backend",
      userId: req.user?.userId ?? "unknown",
      role: req.user?.role ?? "unknown",
      path: req.originalUrl,
      method: req.method,
      reason,
      timestamp: new Date().toISOString(),
    }),
  );
};

export const enforceRBAC = (options: RBACOptions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Deny by default
    if (!req.user) {
      logRBACDenied(req, "missing_user");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!options.allow.includes(req.user.role)) {
      logRBACDenied(req, "insufficient_role");
      res.status(403).json({
        error: "Forbidden",
        message: `Requires role: ${options.allow.join(", ")}`,
      });
      return;
    }

    next();
  };
};

// Convenience
export const requireUser = enforceRBAC({
  allow: [UserRole.USER, UserRole.VERIFIER, UserRole.ADMIN],
})

export const requireVerifier = enforceRBAC({
  allow: [UserRole.VERIFIER, UserRole.ADMIN],
})

export const requireAdmin = enforceRBAC({
  allow: [UserRole.ADMIN],
})

/**
 * Middleware that ensures the authenticated user is a Verifier with an 'approved' status.
 * Admins are automatically approved.
 */
export const requireActiveVerifier = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (req.user.role === UserRole.ADMIN) {
    return next()
  }

  if (req.user.role !== UserRole.VERIFIER) {
    res.status(403).json({ error: 'Forbidden', message: 'Verifier role required' })
    return
  }

  try {
    const profile = await getVerifierProfile(req.user.userId)
    if (!profile || profile.status !== 'approved') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Verifier account is not active (pending, suspended, or deactivated)',
      })
      return
    }
    ;(req as any).verifier = profile
    next()
  } catch (error) {
    console.error('Error checking verifier status:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
