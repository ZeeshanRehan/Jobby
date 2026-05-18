require("dotenv").config();
const express = require("express");
const cors = require("cors");

const tailorRoute = require("./routes/tailor");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Jobby API alive");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/tailor-resume", tailorRoute);

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});