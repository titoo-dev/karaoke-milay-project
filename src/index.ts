import { Hono } from 'hono';
import { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { v4 as uuidv4 } from 'uuid';
import { cors } from 'hono/cors';

type Bindings = {
	AUDIO_FILES: R2Bucket;
	AUDIO_KV: KVNamespace;
	COVER_FILES: R2Bucket;
	PROJECT_KV: KVNamespace;
};

const app = new Hono<{
	Bindings: Bindings;
}>();

type Project = {
	id: string;
	name: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
	lyricsId?: string;
	audioId: string;
	assetIds?: string[];
};

async function saveProject(env: KVNamespace, project: Project) {
	project.updatedAt = new Date().toISOString();
	await env.put(`project:${project.id}`, JSON.stringify(project));
}

app.use('*', cors());

app.post('/project', async (c) => {
	const { name, audioId } = await c.req.json();

	const id = uuidv4();
	const now = new Date().toISOString();
	const project: Project = {
		id,
		name,
		createdAt: now,
		updatedAt: now,
		audioId,
	};

	await saveProject(c.env.PROJECT_KV, project);

	return c.json({ message: 'Project created', id });
});

// get all projects
app.get('/projects', async (c) => {
	const keys = await c.env.PROJECT_KV.list({ prefix: 'project:' });

	if (!keys.keys.length) return c.json({ projects: [] });

	const projects = await Promise.all(
		keys.keys.map(async (key) => {
			const raw = await c.env.PROJECT_KV.get(key.name);
			return JSON.parse(raw!);
		})
	);

	return c.json(projects);
});

app.get('/project/:id', async (c) => {
	const id = c.req.param('id');
	const raw = await c.env.PROJECT_KV.get(`project:${id}`);
	if (!raw) return c.text('Project not found', 404);
	return c.json(JSON.parse(raw));
});

app.put('/project/:id', async (c) => {
	const id = c.req.param('id');
	const raw = await c.env.PROJECT_KV.get(`project:${id}`);
	if (!raw) return c.text('Project not found', 404);

	const project = JSON.parse(raw);
	const updates = await c.req.json();

	// Apply changes
	Object.assign(project, updates);
	await saveProject(c.env.PROJECT_KV, project);

	return c.json({ message: 'Project updated', project });
});

app.delete('/project/:id', async (c) => {
	const id = c.req.param('id');
	const rawProject = await c.env.PROJECT_KV.get(`project:${id}`);
	if (!rawProject) return c.text('Project not found', 404);

	const project = JSON.parse(rawProject);

	const rawAudio = await c.env.AUDIO_KV.get(`audio:${project.audioId}`);

	if (!rawAudio) return c.text('Audio not found', 404);

	const audio = JSON.parse(rawAudio);

	await c.env.PROJECT_KV.delete(`project:${id}`);
	await c.env.AUDIO_KV.delete(`audio:${audio.id}`);

	await c.env.AUDIO_FILES.delete(`${audio.id}.mp3`);

	const coverKey = `${audio.coverArt.id}.${
		audio.coverArt.format.split('/')[1] || 'jpg'
	}`;

	await c.env.COVER_FILES.delete(coverKey);

	return c.json({ message: 'Project deleted', id });
});

export default app;
