const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // for JSON bodies

mongoose.connect(process.env.MONGO_URL, {
    dbName: "agrilens"
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// Multer setup to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// POST /diagnose - accepts image upload (single or multiple)
app.post('/diagnose', upload.array('images'), async (req, res) => {
    try {
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: "No image uploaded" });
        }

        const base64Images = files.map(file => file.buffer.toString('base64'));

        const payload = {
            type: base64Images.length > 1 ? "multiple" : "single",
            data: base64Images.length > 1 ? base64Images : base64Images[0]
        };
        const response = await axios.post(`${process.env.MODEL_URL}`, payload);

        return res.json(response.data);
    } catch (error) {
        console.error("Diagnosis error:", error.message);
        return res.status(500).json({ error: "Failed to diagnose image" });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
