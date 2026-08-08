import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { matchIdParamSchema } from '../validation/matches.js';
import { createCommentarySchema, listCommentaryQuerySchema } from '../validation/commentary.js';
import { commentary } from '../db/schema.js';
import { db } from '../db/db.js';

export const commentaryRouter = Router({ mergeParams: true });

const MAX_LIMIT = 100;

commentaryRouter.get('/', async (req, res) => {
  const paramParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    return res.status(400).json({
      error: 'Invalid match ID parameter',
      details: paramParsed.error.issues,
    });
  }

  const queryParsed = listCommentaryQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: queryParsed.error.issues,
    });
  }

  try {
    const matchId = paramParsed.data.id;
    const limit = Math.min(queryParsed.data?.limit ?? MAX_LIMIT, MAX_LIMIT);

    const list = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, matchId))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    return res.json({ data: list });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to list commentary',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

commentaryRouter.post('/', async (req, res) => {
  const paramParsed = matchIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    return res.status(400).json({
      error: 'Invalid match ID parameter',
      details: paramParsed.error.issues,
    });
  }

  const bodyParsed = createCommentarySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({
      error: 'Invalid commentary payload',
      details: bodyParsed.error.issues,
    });
  }

  try {
    const matchId = paramParsed.data.id;
    const [insertedCommentary] = await db
      .insert(commentary)
      .values({
        matchId,
        ...bodyParsed.data,
      })
      .returning();

    if (req.app.locals.broadcastCommentary) {
      req.app.locals.broadcastCommentary(matchId, insertedCommentary);
    }

    return res.status(201).json({ data: insertedCommentary });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create commentary',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});
