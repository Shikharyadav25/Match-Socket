import { Router } from 'express';
import { createMatchSchema, listMatchesQuerySchema } from '../validation/matches.js';
import { matches } from "../db/schema.js";
import { db } from "../db/db.js";
import { getMatchStatus } from '../utils/match-status.js';
import { desc } from 'drizzle-orm';
import { Result } from 'pg';

export const matchRouter = Router();

const MAX_LIMIT = 100;

matchRouter.get('/', async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);

    if(!parsed.success){
        return res.status(400).json({ error: 'Invalid payload', details: JSON.stringify(parsed.error) });
    }
    const limit = Math.min(parsed.data?.limit ?? 50 , MAX_LIMIT);

    try{
        const data = await db.select().from(matches).orderBy(desc(matches.createdAt)).limit(limit);

        res.json( { data });

    } catch(e){
        res.status(500).json({ error: 'Failed to list matches' });
    }
})

matchRouter.post('/', async (req, res) => {
    const parsed = createMatchSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: JSON.stringify(parsed.error) });
    }

    const { startTime, endTime, homeScore, awayScore } = parsed.data;
    try {
        const [result] = await db.insert(matches).values({
            ...parsed.data,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            status: getMatchStatus(startTime, endTime)
        }).returning();

        if(res.app.locals.broadcastMatchCreated){
            res.app.locals.broadcastMatchCreated(result);
        }

        res.status(201).json({ data: result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create match', details: e?.message || String(e) });
    }
})