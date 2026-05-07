const express = require('express');
const { getDb } = require('../db/init');
const {
  getAllWorkspaces, getWorkspaceById,
  insertWorkspace, updateWorkspace, deleteWorkspace,
} = require('../db/queries');

const router = express.Router();

router.get('/workspaces', (req, res) => {
  const db   = getDb();
  const rows = getAllWorkspaces(db);
  const workspaces = rows.map(row => ({
    id:          row.id,
    name:        row.name,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    ...JSON.parse(row.data),
  }));
  res.json(workspaces);
});

router.post('/workspaces', (req, res) => {
  const { id, name, createdAt, updatedAt, primary, competitors } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
  const db  = getDb();
  const now = new Date().toISOString();
  insertWorkspace(db, {
    id,
    name,
    created_at: createdAt || now,
    updated_at: updatedAt || now,
    data: JSON.stringify({ primary: primary ?? null, competitors: competitors ?? [] }),
  });
  res.json({ id, created: true });
});

router.put('/workspaces/:id', (req, res) => {
  const { id }                         = req.params;
  const { name, updatedAt, primary, competitors } = req.body;
  const db       = getDb();
  const existing = getWorkspaceById(db, id);
  if (!existing) return res.status(404).json({ error: 'Workspace not found' });
  const current  = JSON.parse(existing.data);
  updateWorkspace(db, id, {
    name:       name       ?? existing.name,
    updated_at: updatedAt  ?? new Date().toISOString(),
    data: JSON.stringify({
      primary:     primary     !== undefined ? primary     : current.primary,
      competitors: competitors !== undefined ? competitors : current.competitors,
    }),
  });
  res.json({ id, updated: true });
});

router.delete('/workspaces/:id', (req, res) => {
  deleteWorkspace(getDb(), req.params.id);
  res.json({ id: req.params.id, deleted: true });
});

module.exports = router;
