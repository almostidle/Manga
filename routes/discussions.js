const express = require('express');
const router = express.Router();
const Thread = require('../models/Thread');
const Manga = require('../models/Manga');
const { isAuthenticated } = require('../middleware/auth');

// GET /discussions - List all discussion threads with Search
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let dbQuery = {};

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeSearch, 'i');

      // STEP 1: Find any Manga that matches the search name
      const matchingMangas = await Manga.find({ title: regex }).select('_id');
      const matchingMangaIds = matchingMangas.map(m => m._id);

      // STEP 2: Find Threads that match Title OR Content OR the Found Manga IDs
      dbQuery = {
        $or: [
          { title: regex },
          { content: regex },
          { manga: { $in: matchingMangaIds } }
        ]
      };
    }

    const threads = await Thread.find(dbQuery)
      .populate('user', 'username')
      .populate('manga', 'title coverImage')
      .sort({ updatedAt: -1 })
      .limit(20);

    res.render('discussions/list', { 
      title: 'Discussions',
      threads,
      search: search || '' 
    });

  } catch (error) {
    console.error(error);
    res.render('discussions/list', { 
      title: 'Discussions', 
      threads: [], 
      search: '' 
    });
  }
});

// GET /discussions/create - Show create thread form
router.get('/create', isAuthenticated, async (req, res) => {
  try {
    const manga = await Manga.find().sort({ title: 1 });
    res.render('discussions/create', { 
      title: 'Create Discussion',
      manga
    });
  } catch (error) {
    console.error(error);
    res.redirect('/discussions');
  }
});

// POST /discussions/create - Create new thread
router.post('/create', isAuthenticated, async (req, res) => {
  try {
    const { manga, title, content } = req.body;

    if (!manga || !title || !content) {
      req.flash('error', 'All fields are required');
      return res.redirect('/discussions/create');
    }

    const thread = new Thread({
      manga,
      user: req.session.user.id,
      title,
      content
    });

    await thread.save();
    req.flash('success', 'Discussion created successfully!');
    res.redirect(`/discussions/${thread._id}`);
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error creating discussion');
    res.redirect('/discussions/create');
  }
});

// =========================================================
//  NEW: API Endpoint for Live Polling (AJAX)
// =========================================================
router.get('/:id/api/replies', async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id)
      .populate('replies.user', 'username'); // Must populate to show names

    if (!thread) return res.status(404).json([]);

    res.json(thread.replies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /discussions/:id - View thread details
router.get('/:id', async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id)
      .populate('user', 'username')
      .populate('manga', 'title coverImage')
      .populate('replies.user', 'username');

    if (!thread) {
      req.flash('error', 'Discussion not found');
      return res.redirect('/discussions');
    }

    // Increment views
    thread.views += 1;
    await thread.save();

    res.render('discussions/detail', { 
      title: thread.title,
      thread
    });
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error loading discussion');
    res.redirect('/discussions');
  }
});

// =========================================================
//  UPDATED: Reply Route (Handles JSON/AJAX + Standard Form)
// =========================================================
router.post('/:id/reply', isAuthenticated, async (req, res) => {
  try {
    const { content } = req.body;

    // 1. Validation
    if (!content) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(400).json({ error: 'Content required' });
      }
      req.flash('error', 'Reply content is required');
      return res.redirect(`/discussions/${req.params.id}`);
    }

    const thread = await Thread.findById(req.params.id);
    if (!thread) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }
      req.flash('error', 'Discussion not found');
      return res.redirect('/discussions');
    }

    // 2. Create Reply Object
    const newReply = {
      user: req.session.user.id,
      content,
      createdAt: new Date()
    };

    thread.replies.push(newReply);
    await thread.save();

    // 3. Handle AJAX (JSON Response)
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      // We manually construct the response because 'newReply' user is just an ID.
      // We trust req.session.user contains the username.
      const responseReply = {
        ...thread.replies[thread.replies.length - 1].toObject(), // Get the saved object (with _id)
        user: { username: req.session.user.username } // Attach username for frontend display
      };
      
      return res.json({ success: true, reply: responseReply });
    }

    // 4. Handle Standard Post (Page Reload)
    req.flash('success', 'Reply added successfully!');
    res.redirect(`/discussions/${req.params.id}`);

  } catch (error) {
    console.error(error);
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(500).json({ error: 'Server error' });
    }
    req.flash('error', 'Error adding reply');
    res.redirect(`/discussions/${req.params.id}`);
  }
});

// DELETE /discussions/:id - Delete thread
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id);

    if (!thread) {
      req.flash('error', 'Discussion not found');
      return res.redirect('/discussions');
    }

    // Check if user owns the thread
    if (thread.user.toString() !== req.session.user.id) {
      req.flash('error', 'You can only delete your own discussions');
      return res.redirect('/discussions');
    }

    await Thread.findByIdAndDelete(req.params.id);
    req.flash('success', 'Discussion deleted successfully');
    res.redirect('/discussions');
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error deleting discussion');
    res.redirect('/discussions');
  }
});

module.exports = router;