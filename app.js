// Job Market Dashboard - Backend API
// Node.js + Express backend for aggregating job postings

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// TARGET COMPANIES
const TARGET_COMPANIES = {
  mbb: ['McKinsey', 'BCG', 'Bain'],
  bigFour: ['Deloitte', 'EY', 'KPMG', 'PwC'],
  boutique: ['Oliver Wyman', 'Booz Allen', 'AT Kearney', 'Accenture', 'FTI Consulting', 'Evercore'],
  bulgeBracket: ['Goldman Sachs', 'Morgan Stanley', 'JP Morgan', 'Bank of America', 'Barclays', 'Citigroup', 'Credit Suisse', 'Lazard', 'Evercore', 'Centerview']
};

// JOB BOARD API INTEGRATIONS
async function fetchFromJSearch() {
  try {
    const keywords = 'consultant OR analyst OR "investment banking"';
    const locations = 'Boston OR "New York"';

    const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query: keywords,
        location: locations,
        date_posted: 'past_3_days',
        page: 1,
        num_pages: 5
      },
      headers: {
        'x-rapidapi-key': process.env.JSEARCH_API_KEY,
        'x-rapidapi-host': 'jsearch.p.rapidapi.com'
      }
    });

    return formatJSearchResults(response.data.data || []);
  } catch (error) {
    console.error('JSearch fetch error:', error);
    return [];
  }
}

function formatJSearchResults(jobs) {
  return jobs.map(job => ({
    id: job.job_id,
    title: job.job_title,
    company: job.employer_name,
    location: job.job_location,
    region: detectRegion(job.job_location),
    jobType: detectJobType(job.job_title, job.job_description),
    postedDate: new Date(job.job_posted_utc_timestamp),
    source: job.job_publisher,
    url: job.job_apply_link,
    description: job.job_description,
    salary: job.job_salary_standardized,
    experienceLevel: detectExperienceLevel(job.job_title)
  }));
}

function detectRegion(location) {
  const loc = location.toLowerCase();
  if (loc.includes('boston') || loc.includes('cambridge') || loc.includes('massachusetts')) {
    return 'Boston/Cambridge';
  }
  if (loc.includes('new york') || loc.includes('ny ') || loc.includes('nyc')) {
    return 'New York';
  }
  return 'Other';
}

function detectJobType(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('investment banking') || text.includes('ib analyst') || text.includes('banking analyst')) {
    return 'investment_banking';
  }
  if (text.includes('intern')) {
    return 'internship';
  }
  if (text.includes('consultant') || text.includes('analyst')) {
    return 'consulting';
  }
  return 'other';
}

function detectExperienceLevel(title) {
  const t = title.toLowerCase();
  if (t.includes('associate') || t.includes('entry')) {
    return 'associate';
  }
  if (t.includes('junior') || t.includes('intern')) {
    return 'analyst';
  }
  return 'analyst';
}

// API ROUTES
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await fetchFromJSearch();
    const filtered = jobs.filter(job =>
      (job.region === 'Boston/Cambridge' || job.region === 'New York') &&
      ['consulting', 'investment_banking', 'internship'].includes(job.jobType)
    );

    res.json({
      success: true,
      count: filtered.length,
      jobs: filtered.sort((a, b) => b.postedDate - a.postedDate)
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/companies', async (req, res) => {
  try {
    const jobs = await fetchFromJSearch();
    const companyStats = {};
    jobs.forEach(job => {
      if (!companyStats[job.company]) {
        companyStats[job.company] = {
          name: job.company,
          count: 0,
          regions: {},
          types: {}
        };
      }
      companyStats[job.company].count++;
      companyStats[job.company].regions[job.region] = (companyStats[job.company].regions[job.region] || 0) + 1;
      companyStats[job.company].types[job.jobType] = (companyStats[job.company].types[job.jobType] || 0) + 1;
    });

    const sorted = Object.values(companyStats)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    res.json({ success: true, companies: sorted });
  } catch (error) {
    console.error('Error fetching company data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/trends', async (req, res) => {
  try {
    const jobs = await fetchFromJSearch();
    const trends = {
      boston: {},
      nyc: {},
      byType: { consulting: {}, investment_banking: {}, internship: {} }
    };

    jobs.forEach(job => {
      const date = job.postedDate.toISOString().split('T')[0];
      if (job.region === 'Boston/Cambridge') {
        trends.boston[date] = (trends.boston[date] || 0) + 1;
      } else if (job.region === 'New York') {
        trends.nyc[date] = (trends.nyc[date] || 0) + 1;
      }
      if (trends.byType[job.jobType]) {
        trends.byType[job.jobType][date] = (trends.byType[job.jobType][date] || 0) + 1;
      }
    });

    res.json({ success: true, trends });
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Job Dashboard Backend running on port ${PORT}`);
});

module.exports = app;
