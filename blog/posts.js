/* ==========================================================================
   Druk.help — post index
   This is the single list that drives the blog index page and the
   "more writing" cards at the bottom of every post.

   To add a post: put a new object at the TOP of the array below, then create
   the matching HTML file in this folder (copy _template.html).
   Or let the script do both:  node blog/new-post.mjs "Your post title"

   Fields
     slug     required  file name without .html, e.g. "care-live-in-bhutan"
     title    required  shown on the card and in search
     date     required  ISO date, YYYY-MM-DD — the list sorts newest first
     excerpt  required  one or two sentences shown under the title
     author   optional  defaults to nothing if omitted
     tags     optional  array of short labels; they become the filter buttons
   ========================================================================== */

window.DRUK_POSTS = [
  {
    "slug": "expanding-palliative-care-across-bhutan",
    "title": "Expanding Palliative Care Across Bhutan",
    "date": "2026-09-15",
    "author": "Druk.help",
    "excerpt": "Palliative care already runs in 15 districts. Reaching the rest will take volunteers, caregivers, and a training programme the team is about to join.",
    "image": "images/blog2.jpeg",
    "tags": [
      "Bhutan",
      "Healthcare",
      "Palliative Care"
    ]
  },
  {
    "slug": "building-sustainable-digital-solutions-bhutan",
    "title": "Building Sustainable Digital Solutions for Healthcare and Disability Support in Bhutan",
    "date": "2026-09-10",
    "author": "Druk.help",
    "excerpt": "Two meetings in one day, with GMC and DPOB, on what it would take to build digital tools Bhutan can own, sustain and scale from within.",
    "image": "images/building-sustainable-digital-solutions-bhutan.svg",
    "tags": [
      "Bhutan",
      "Healthcare",
      "Partnerships"
    ]
  }
];
