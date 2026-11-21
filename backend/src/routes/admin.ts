import { Router, Request, Response } from 'express';
import { requireAuth, requireGuildAdmin } from '../middleware/auth';
import { DiscordClient } from '../discord';
import { db } from '../db';

const router = Router();

// A. INDIVIDUAL ACTIONS
// 1. Kick Member
router.post('/:guildId/actions/kick', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { userId, userTag, reason } = req.body;
  const executor = req.session.user!;

  if (!userId || !userTag) {
    return res.status(400).json({ error: 'Missing userId or userTag in request.' });
  }

  try {
    // 1. Execute Kick in Discord API
    await DiscordClient.kickMember(guildId, userId, reason || `Kicked via Web Dashboard by ${executor.username}`);

    // 2. Log in PostgreSQL
    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [guildId, 'KICK', userId, userTag, executor.id, `${executor.username}#${executor.discriminator}`, reason || null]
    );

    res.json({ success: true, message: `Successfully kicked member ${userTag}.` });
  } catch (err: any) {
    console.error(`[Admin API] Individual Kick failed:`, err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Failed to kick user from server.' });
  }
});

// 2. Ban Member
router.post('/:guildId/actions/ban', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { userId, userTag, reason, deleteMessageDays } = req.body;
  const executor = req.session.user!;

  if (!userId || !userTag) {
    return res.status(400).json({ error: 'Missing userId or userTag in request.' });
  }

  try {
    // 1. Execute Ban in Discord API
    await DiscordClient.banMember(
      guildId, 
      userId, 
      deleteMessageDays || 0, 
      reason || `Banned via Web Dashboard by ${executor.username}`
    );

    // 2. Log in PostgreSQL
    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [guildId, 'BAN', userId, userTag, executor.id, `${executor.username}#${executor.discriminator}`, reason || null]
    );

    res.json({ success: true, message: `Successfully banned member ${userTag}.` });
  } catch (err: any) {
    console.error(`[Admin API] Individual Ban failed:`, err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Failed to ban user from server.' });
  }
});

// B. AUTOMATED MASS ACTIONS (Mass kick/ban & bulk role changes)

// Sequential queue helper to run bulk requests gracefully and protect bot client from getting flagged
async function processSequentialActions(
  userIds: string[],
  actionFn: (id: string) => Promise<any>
): Promise<{ succeeded: string[]; failed: { id: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of userIds) {
    try {
      await actionFn(id);
      succeeded.push(id);
      // Wait 250 milliseconds between actions to distribute load and preserve rate limit balances
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err: any) {
      console.error(`[Mass Action] Failed for user ${id}:`, err.message);
      failed.push({ id, error: err.message || 'Discord API error' });
    }
  }

  return { succeeded, failed };
}

// 3. Mass Kick Members
router.post('/:guildId/actions/mass-kick', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { userIds, userTags, reason } = req.body; // array of IDs and Tags
  const executor = req.session.user!;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Missing or empty userIds array.' });
  }

  try {
    console.log(`[Admin API] Processing mass-kick of ${userIds.length} members in guild ${guildId}...`);

    // Execute bulk operation sequentially with delay
    const results = await processSequentialActions(userIds, (id) =>
      DiscordClient.kickMember(guildId, id, reason || `Mass kicked via Web Dashboard by ${executor.username}`)
    );

    // Save summary detail logs in database
    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        guildId,
        'MASS_KICK',
        'BULK_TARGET',
        `Bulk operation on ${userIds.length} members`,
        executor.id,
        `${executor.username}#${executor.discriminator}`,
        reason || 'Mass administrative enforcement',
        JSON.stringify({
          attemptedCount: userIds.length,
          succeededCount: results.succeeded.length,
          failedCount: results.failed.length,
          failures: results.failed
        })
      ]
    );

    res.json({
      success: true,
      summary: {
        attempted: userIds.length,
        succeeded: results.succeeded.length,
        failed: results.failed.length
      },
      failures: results.failed
    });
  } catch (err: any) {
    console.error(`[Admin API] Mass Kick Route error:`, err.message);
    res.status(500).json({ error: 'Failed to process bulk kick operation.' });
  }
});

// 4. Mass Ban Members
router.post('/:guildId/actions/mass-ban', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { userIds, userTags, reason, deleteMessageDays } = req.body;
  const executor = req.session.user!;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Missing or empty userIds array.' });
  }

  try {
    console.log(`[Admin API] Processing mass-ban of ${userIds.length} members in guild ${guildId}...`);

    const results = await processSequentialActions(userIds, (id) =>
      DiscordClient.banMember(
        guildId,
        id,
        deleteMessageDays || 0,
        reason || `Mass banned via Web Dashboard by ${executor.username}`
      )
    );

    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        guildId,
        'MASS_BAN',
        'BULK_TARGET',
        `Bulk operation on ${userIds.length} members`,
        executor.id,
        `${executor.username}#${executor.discriminator}`,
        reason || 'Mass administrative enforcement',
        JSON.stringify({
          attemptedCount: userIds.length,
          succeededCount: results.succeeded.length,
          failedCount: results.failed.length,
          failures: results.failed
        })
      ]
    );

    res.json({
      success: true,
      summary: {
        attempted: userIds.length,
        succeeded: results.succeeded.length,
        failed: results.failed.length
      },
      failures: results.failed
    });
  } catch (err: any) {
    console.error(`[Admin API] Mass Ban Route error:`, err.message);
    res.status(500).json({ error: 'Failed to process bulk ban operation.' });
  }
});

// 5. Bulk Roles Management (Add or Remove role from multiple members)
router.post('/:guildId/actions/bulk-roles', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { userIds, roleId, mode, reason } = req.body; // mode: 'ADD' or 'REMOVE'
  const executor = req.session.user!;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !roleId || !mode) {
    return res.status(400).json({ error: 'Missing userIds, roleId or mode parameters.' });
  }

  try {
    console.log(`[Admin API] Processing bulk-roles (${mode}) for ${userIds.length} members in guild ${guildId}...`);

    // Fetch members to check their current roles
    const members = await DiscordClient.getGuildMembers(guildId);

    const results = await processSequentialActions(userIds, async (id) => {
      const member = members.find((m) => m.user.id === id);
      if (!member) throw new Error('Member not found in current guild fetch cache.');

      let updatedRoles = [...member.roles];

      if (mode === 'ADD') {
        if (!updatedRoles.includes(roleId)) {
          updatedRoles.push(roleId);
        }
      } else if (mode === 'REMOVE') {
        updatedRoles = updatedRoles.filter((rid) => rid !== roleId);
      }

      await DiscordClient.updateMemberRoles(
        guildId, 
        id, 
        updatedRoles, 
        reason || `Bulk role ${mode} via Web Dashboard by ${executor.username}`
      );
    });

    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        guildId,
        'ROLE_CHANGE',
        'BULK_TARGET',
        `Bulk role ${mode} of role ${roleId}`,
        executor.id,
        `${executor.username}#${executor.discriminator}`,
        reason || 'Bulk role update',
        JSON.stringify({
          mode,
          roleId,
          attemptedCount: userIds.length,
          succeededCount: results.succeeded.length,
          failedCount: results.failed.length,
          failures: results.failed
        })
      ]
    );

    res.json({
      success: true,
      summary: {
        attempted: userIds.length,
        succeeded: results.succeeded.length,
        failed: results.failed.length
      },
      failures: results.failed
    });
  } catch (err: any) {
    console.error(`[Admin API] Bulk roles error:`, err.message);
    res.status(500).json({ error: 'Failed to process bulk role modification.' });
  }
});

// 6. Create Channel
router.post('/:guildId/actions/channels', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const { name, type, parentId } = req.body;
  const executor = req.session.user!;

  if (!name || type === undefined) {
    return res.status(400).json({ error: 'Missing channel name or type.' });
  }

  try {
    const channel = await DiscordClient.createChannel(guildId, name, type, parentId);

    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [guildId, 'CHANNEL_CREATE', channel.id, `#${name} (Type ${type})`, executor.id, `${executor.username}#${executor.discriminator}`, 'Created channel via dashboard']
    );

    res.json({ success: true, channel });
  } catch (err: any) {
    console.error(`[Admin API] Create channel failed:`, err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Failed to create channel.' });
  }
});

// 7. Delete Channel
router.delete('/:guildId/actions/channels/:channelId', requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  const { guildId, channelId } = req.params;
  const { name } = req.query;
  const executor = req.session.user!;

  try {
    await DiscordClient.deleteChannel(channelId);

    await db.query(
      `INSERT INTO moderation_logs (guild_id, action_type, target_id, target_tag, executor_id, executor_tag, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [guildId, 'CHANNEL_DELETE', channelId, `#${name || 'deleted-channel'}`, executor.id, `${executor.username}#${executor.discriminator}`, 'Deleted channel via dashboard']
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error(`[Admin API] Delete channel failed:`, err.message);
    res.status(500).json({ error: err.response?.data?.message || 'Failed to delete channel.' });
  }
});

export default router;
