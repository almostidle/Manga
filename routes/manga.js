const express = require('express');
const router = express.Router();
const Manga = require('../models/Manga');
const Rating = require('../models/Rating');
const Thread = require('../models/Thread');
const { isAuthenticated } = require('../middleware/auth');

// GET /manga - List all manga
router.get('/', async (req, res) => {
  try {
    const manga = await Manga.find().sort({ title: 1 });
    res.render('manga/list', { 
      title: 'All Manga',
      manga
    });
  } catch (error) {
    console.error(error);
    res.render('manga/list', { title: 'All Manga', manga: [] });
  }
});

// GET /manga/:id - View manga details
router.get('/:id', async (req, res) => {
  try {
    const manga = await Manga.findById(req.params.id);
    if (!manga) {
      req.flash('error', 'Manga not found');
      return res.redirect('/');
    }

    // Increment view count
    manga.viewCount += 1;
    await manga.save();

    // Get user's rating if logged in
    let userRating = null;
    if (req.session.user) {
      userRating = await Rating.findOne({
        manga: manga._id,
        user: req.session.user.id
      });
    }

    // Get threads for this manga
    const threads = await Thread.find({ manga: manga._id })
      .populate('user', 'username')
      .sort({ createdAt: -1 })
      .limit(5);

    res.render('manga/detail', { 
      title: manga.title,
      manga,
      userRating: userRating ? userRating.rating : 0,
      threads
    });
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error loading manga');
    res.redirect('/');
  }
});

// POST /manga/:id/rate - Rate a manga (CRUD: Create/Update)
router.post('/:id/rate', isAuthenticated, async (req, res) => {
  try {
    const { rating } = req.body;
    const mangaId = req.params.id;
    const userId = req.session.user.id;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      req.flash('error', 'Invalid rating value');
      return res.redirect(`/manga/${mangaId}`);
    }
    await Rating.findOneAndUpdate(
      { manga: mangaId, user: userId }, // Search Query
      { rating: rating },               // Update Data
      { upsert: true, new: true }       // Options: Create if missing
    );

    // Check if user already rated
    let existingRating = await Rating.findOne({
      manga: mangaId,
      user: userId
    });

    if (existingRating) {
      // Update existing rating
      existingRating.rating = rating;
      await existingRating.save();
    } else {
      // Create new rating
      existingRating = new Rating({
        manga: mangaId,
        user: userId,
        rating: rating
      });
      await existingRating.save();
    }

    // Recalculate average rating
    const allRatings = await Rating.find({ manga: mangaId });
    const totalRating = allRatings.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalRating / allRatings.length;

    // Update manga
    await Manga.findByIdAndUpdate(mangaId, {
      averageRating: averageRating,
      ratingCount: allRatings.length
    });

    req.flash('success', 'Rating submitted successfully!');
    res.redirect(`/manga/${mangaId}`);
  } catch (error) {
    console.error(error);
    req.flash('error', 'Error submitting rating');
    res.redirect(`/manga/${req.params.id}`);
  }
});

module.exports = router;
