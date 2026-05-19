const ws = require("ws");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { realtime: { transport: ws } }
);

async function uploadPdf(pdfBuffer, filename) {
  const { error: uploadError } = await supabase.storage
    .from("Resumes")
    .upload(filename, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  const { data, error: urlError } = await supabase.storage
    .from("Resumes")
    .createSignedUrl(filename, 3600);

  if (urlError) {
    throw new Error(`Supabase signed URL failed: ${urlError.message}`);
  }

  return data.signedUrl;
}

module.exports = { uploadPdf };
