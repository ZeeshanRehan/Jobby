const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Uploads a PDF buffer to Supabase Storage and returns a signed download URL.
 * @param {Buffer} pdfBuffer - The raw PDF bytes from Puppeteer
 * @param {string} filename - e.g. "resume_1716000000000.pdf"
 * @returns {string} signedUrl - time-limited download link
 */
async function uploadPdf(pdfBuffer, filename) {
  // Upload the buffer into the "resumes" bucket
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(filename, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true, // overwrite if same filename exists
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  // Generate a signed URL valid for 1 hour (3600 seconds)
  const { data, error: urlError } = await supabase.storage
    .from("resumes")
    .createSignedUrl(filename, 3600);

  if (urlError) {
    throw new Error(`Supabase signed URL failed: ${urlError.message}`);
  }

  return data.signedUrl;
}

module.exports = { uploadPdf };
