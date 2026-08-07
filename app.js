const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Setup
const MONGODB_URI = process.env.MONGODB_URI;
let db = null;
let client = null;

// Connect to MongoDB
async function connectMongo() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('job_dashboard');
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// CORS
app.use(cors({
  origin: ['https://jobs.carlsoncareercoach.com', 'https://job-dashboard-frontend.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fetch jobs from JSearch and store in MongoDB
async function fetchAndStoreJobs() {
  console.log('🔄 Fetching jobs from JSearch...');
  try {
    const options = {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      params: {
        query: 'consulting analyst OR investment banking analyst OR management consultant boston new york',
        page: '1',
        num_pages: '5'
      },
      headers: {
        'x-rapidapi-key': process.env.JSEARCH_API_KEY,
        'x-rapidapi-host': 'jsearch.p.rapidapi.com'
      }
    };

    const response = await axios.request(options);
    const jobs = response.data.data || [];

    // Process and normalize jobs
    const processedJobs = jobs.map(job => ({
      job_id: job.job_id,
      job_title: job.job_title || '',
      company_name: job.employer_name || '',
      location: job.job_city && job.job_state ? `${job.job_city}, ${job.job_state}` : job.job_location_display || '',
      job_type: determineJobType(job.job_title),
      job_description: job.job_description || '',
      job_apply_link: job.job_apply_link || '',
      posted_date: job.job_posted_at_datetime_utc || new Date(),
      salary: job.job_salary_standardized_year_amount || null,
      fetched_at: new Date()
    })).filter(job => isRelevantJob(job));

    if (processedJobs.length > 0) {
      const collection = db.collection('jobs');
      
      // Replace old jobs with new ones
      await collection.deleteMany({});
      await collection.insertMany(processedJobs);
      
      console.log(`✅ Stored ${processedJobs.length} jobs in MongoDB`);
    } else {
      console.log('⚠️ No relevant jobs found');
    }
  } catch (error) {
    console.error('❌ Error fetching jobs:', error.message);
  }
}

// Determine job type
function determineJobType(title) {
  const lower = (title || '').toLowerCase();
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('banking') || lower.includes('analyst') || lower.includes('associate')) return 'investment banking';
  if (lower.includes('consult') || lower.includes('strategy')) return 'consulting';
  return 'other';
}

// Check if job is relevant
function isRelevantJob(job) {
  const title = (job.job_title || '').toLowerCase();
  const location = (job.location || '').toLowerCase();
  
  const relevant_keywords = ['consultant', 'analyst', 'associate', 'intern', 'strategy', 'banking'];
  const has_keyword = relevant_keywords.some(kw => title.includes(kw));
  
  const relevant_locations = ['boston', 'cambridge', 'new york', 'nyc'];
  const has_location = relevant_locations.some(loc => location.includes(loc));
  
  return has_keyword && has_location;
}

// Schedule daily job fetch at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ Running scheduled job fetch');
  await fetchAndStoreJobs();
});

// API Routes

// Get all jobs with optional filters
app.get('/api/jobs', async (req, res) => {
  try {
    const { region, type, search } = req.query;
    const collection = db.collection('jobs');
    
    let query = {};
    
    if (region && region !== 'all') {
      query.location = { $regex: region, $options: 'i' };
    }
    
    if (type && type !== 'all') {
      query.job_type = { $regex: type, $options: 'i' };
    }
    
    if (search) {
      query.$or = [
        { company_name: { $regex: search, $options: 'i' } },
        { job_title: { $regex: search, $options: 'i' } }
      ];
    }
    
    const jobs = await collection.find(query).sort({ posted_date: -1 }).limit(100).toArray();
    
    res.json({
      success: true,
      count: jobs.length,
      jobs: jobs,
      lastFetched: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get company hiring trends
app.get('/api/companies', async (req, res) => {
  try {
    const collection = db.collection('jobs');
    
    const companies = await collection.aggregate([
      { $group: { _id: '$company_name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();
    
    res.json({
      success: true,
      data: companies.map(c => ({ name: c._id, jobs: c.count }))
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get hiring trends by type
app.get('/api/trends', async (req, res) => {
  try {
    const collection = db.collection('jobs');
    
    const trends = await collection.aggregate([
      { $group: { _id: '$job_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    res.json({
      success: true,
      data: trends.map(t => ({ type: t._id, count: t.count }))
    });
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual refresh endpoint (for admin)
app.post('/api/refresh', async (req, res) => {
  try {
    await fetchAndStoreJobs();
    res.json({ success: true, message: 'Jobs refreshed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  await connectMongo();
  
  // Fetch jobs on startup
  await fetchAndStoreJobs();
  
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (client) await client.close();
  process.exit(0);
});
