import { Router, Request, Response } from 'express';
import { DiscordClient } from '../discord';
import { db } from '../db';
import * as crypto from 'crypto';

const router = Router();

const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Direct to Discord OAuth2 Login
router.get('/login', (req: Request, res: Response) => {
  // CSRF protection: generate secure random state and store in user session
  const state = crypto.randomBytes(16).toString('hex');
  (req.session as any).oauthState = state;

  const scopes = 'identify guilds';
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;

  res.json({ url });
});

// OAuth2 Code Callback Receiver
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[OAuth Callback] Discord returned authentication error:', error);
    return res.redirect(`${FRONTEND_URL}/?error=auth_denied`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/?error=missing_parameters`);
  }

  // Verify CSRF state token
  const savedState = (req.session as any).oauthState;
  if (!savedState || state !== savedState) {
    console.error('[OAuth Callback] CSRF State token mismatch. Attack detected or session expired.');
    return res.redirect(`${FRONTEND_URL}/?error=invalid_state`);
  }

  // Clear state now that it's validated
  delete (req.session as any).oauthState;

  try {
    // 1. Exchange code for credentials
    const tokenData = await DiscordClient.exchangeCode(code as string);
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // 2. Fetch User Profile
    const profile = await DiscordClient.getUserProfile(tokenData.access_token);

    // 3. Save User details into DB (UPSERT)
    await db.query(
      `INSERT INTO users (discord_id, username, discriminator, avatar, access_token, refresh_token, token_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (discord_id) DO UPDATE 
       SET username = EXCLUDED.username,
           discriminator = EXCLUDED.discriminator,
           avatar = EXCLUDED.avatar,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           updated_at = CURRENT_TIMESTAMP`,
      [
        profile.id,
        profile.username,
        profile.discriminator,
        profile.avatar,
        tokenData.access_token,
        tokenData.refresh_token,
        expiresAt
      ]
    );

    // 4. Save credentials into session
    req.session.user = {
      id: profile.id,
      username: profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      accessToken: tokenData.access_token
    };

    // Explicitly save the session before redirecting to prevent race conditions in fast browsers
    req.session.save((err) => {
      if (err) {
        console.error('[Session Save Error]:', err);
        return res.redirect(`${FRONTEND_URL}/?error=session_error`);
      }
      console.log(`[Auth Callback] User "${profile.username}#${profile.discriminator}" authenticated successfully.`);
      res.redirect(`${FRONTEND_URL}/servers`);
    });

  } catch (err: any) {
    console.error('[OAuth Callback] Authentication failure:', err.message);
    res.redirect(`${FRONTEND_URL}/?error=server_error`);
  }
});

// User Session validation endpoint
router.get('/me', (req: Request, res: Response) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  
  // Development Mode Fallback Profile
  if (process.env.DISCORD_CLIENT_ID === 'YOUR_DISCORD_CLIENT_ID') {
    return res.json({
      authenticated: true,
      user: {
        id: '800000000000000000',
        username: 'DevAdmin',
        discriminator: '9999',
        avatar: null,
        accessToken: 'dev_mode_token'
      }
    });
  }

  res.json({ authenticated: false });
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[Logout] Session destruction error:', err);
        return res.status(500).json({ error: 'Failed to logout session.' });
      }
      res.clearCookie('connect.sid'); // Clean browser session cookie
      return res.json({ success: true });
    });
  } else {
    res.json({ success: true });
  }
});

export default router;
