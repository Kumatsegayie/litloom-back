# Article Submission Backend Architecture

## Overview
This backend implements a comprehensive article submission and approval workflow where:
- **Users** can submit articles for review
- **Admins** can approve/reject submissions and publish approved articles
- All published articles are created by admins only

## Content Types

### Article Submissions (`article-submission`)
Stores user-submitted articles waiting for admin review.

**Fields:**
- `title` (string, required) - Article title
- `content` (text, required) - Full article content
- `excerpt` (text) - Brief description (max 500 chars)
- `featuredImage` (media) - Main article image
- `additionalImages` (media, multiple) - Supporting images
- `status` (enum) - "pending", "approved", "rejected"
- `reviewNotes` (text) - Admin feedback
- `submittedBy` (string) - Submitter's name
- `submittedByEmail` (email) - Submitter's email
- `category` (relation) - Article category
- `tags` (relation, many-to-many) - Article tags
- `submittedAt` (datetime) - Submission timestamp
- `reviewedAt` (datetime) - Review timestamp
- `reviewedBy` (string) - Admin who reviewed
- `publishedArticle` (relation) - Link to published article

### Articles (`article`)
Published articles (admin-only creation).

**Additional Fields:**
- `submission` (relation) - Links to original submission

## API Endpoints

### Public Endpoints (No Auth Required)

#### Submit Article
```
POST /api/article-submissions/submit
```
**Body:**
```json
{
  "title": "Article Title",
  "content": "Full article content...",
  "excerpt": "Brief description",
  "category": "category-id",
  "tags": ["tag1", "tag2"],
  "featuredImage": "media-id",
  "submittedBy": "User Name",
  "submittedByEmail": "user@example.com"
}
```

**Response:**
```json
{
  "message": "Article submitted successfully. It will be reviewed by our team.",
  "submission": { ... }
}
```

### Admin-Only Endpoints (Authentication Required)

#### Get Pending Submissions
```
GET /api/article-submissions/pending
```
**Response:**
```json
{
  "submissions": [...],
  "count": 5
}
```

#### Approve Submission
```
POST /api/article-submissions/:id/approve
```
**Body:**
```json
{
  "reviewNotes": "Great article! Approved for publication."
}
```

**Response:**
```json
{
  "message": "Article approved and published successfully",
  "article": { ... },
  "submission": { ... }
}
```

#### Reject Submission
```
POST /api/article-submissions/:id/reject
```
**Body:**
```json
{
  "reviewNotes": "Needs more development. Please revise and resubmit."
}
```

**Response:**
```json
{
  "message": "Article submission rejected",
  "submission": { ... }
}
```

## Workflow

### 1. User Submission
1. User fills out submission form
2. Data sent to `/api/article-submissions/submit`
3. Submission created with `status: "pending"`
4. Admin notified (TODO: implement notification system)

### 2. Admin Review
1. Admin views pending submissions via `/api/article-submissions/pending`
2. Admin reviews content and decides to approve or reject

### 3. Approval Process
1. Admin calls `/api/article-submissions/:id/approve`
2. New Article created with submission data
3. Submission status updated to "approved"
4. Submission linked to published article
5. Submitter notified (TODO: implement notification)

### 4. Rejection Process
1. Admin calls `/api/article-submissions/:id/reject`
2. Submission status updated to "rejected"
3. Review notes added
4. Submitter notified (TODO: implement notification)

## Security & Permissions

- **Article Creation**: Admin-only (enforced in controller)
- **Submission Approval/Rejection**: Admin-only (enforced via routes)
- **Viewing Submissions**: Admin-only for pending, public for approved
- **Article Publishing**: Only through approval workflow

## Frontend Integration

### Submission Form
- Located in `ArticlesList.js`
- Form submits to backend API
- Shows success message on submission
- Form validation for required fields

### Admin Dashboard (TODO)
- View pending submissions
- Approve/reject with notes
- Bulk actions
- Notification management

## Future Enhancements

### Notifications
- Email notifications for submitters
- Admin notifications for new submissions
- In-app notifications

### Advanced Features
- Submission revisions
- Auto-moderation
- Quality scoring
- Editorial calendar
- User dashboards

### Analytics
- Submission statistics
- Approval rates
- Content performance
- User engagement

## Setup Instructions

1. **Content Types**: The schema files are already created
2. **Permissions**: Configure Strapi admin to allow public submission endpoint
3. **Email**: Set up email service for notifications
4. **Frontend**: Update auth context to include user data in submissions

## Testing

### Submit Article
```bash
curl -X POST http://localhost:1337/api/article-submissions/submit \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Article",
    "content": "This is a test article content...",
    "excerpt": "Test description",
    "submittedBy": "Test User",
    "submittedByEmail": "test@example.com"
  }'
```

### Get Pending Submissions (Admin)
```bash
curl -X GET http://localhost:1337/api/article-submissions/pending \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"
```

This architecture provides a robust, scalable solution for community-driven content creation with proper editorial oversight.