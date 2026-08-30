import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker URL
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;

export function getGeminiApiKey() {
  return localStorage.getItem('rgqa_gemini_api_key') || localStorage.getItem('rgqa_openai_api_key') || import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '';
}

export function saveGeminiApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('rgqa_gemini_api_key', key.trim());
  } else {
    localStorage.removeItem('rgqa_gemini_api_key');
  }
}

// Aliases for backward compatibility
export const getOpenAIApiKey = getGeminiApiKey;
export const saveOpenAIApiKey = saveGeminiApiKey;

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

export async function getPDFPageCount(file) {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

export async function extractPDFContent(file, selectedPages = null) {
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let pagesToProcess = [];
  if (Array.isArray(selectedPages) && selectedPages.length > 0) {
    pagesToProcess = selectedPages.filter(p => p >= 1 && p <= pdf.numPages).slice(0, 10);
  } else {
    const maxPages = Math.min(pdf.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
      pagesToProcess.push(i);
    }
  }

  let fullText = '';
  const pageImages = [];

  for (const pageNum of pagesToProcess) {
    const page = await pdf.getPage(pageNum);
    
    // Extract text content
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `\n--- [Page ${pageNum}] ---\n` + pageText;

    // Render page to canvas for vision understanding
    try {
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      pageImages.push(dataUrl);
    } catch (e) {
      console.warn(`Failed to render PDF page ${pageNum} to image:`, e);
    }
  }

  return {
    type: 'pdf',
    text: fullText.trim(),
    pageImages,
    numPages: pdf.numPages,
    processedPages: pagesToProcess
  };
}

export async function generateQuizWithAI({
  apiKey,
  file = null,
  files = [],
  selectedPages = null,
  subject = '',
  questionCount = 15,
  difficulty = '초등학교 3~6학년 (자료 내용 기반 자동 설정)',
  customPrompt = '',
  model = 'gemini-2.5-flash'
}) {
  const keyToUse = apiKey || getGeminiApiKey();
  if (!keyToUse) {
    throw new Error('Gemini API Key가 설정되지 않았습니다. API 키를 입력하거나 설정해주세요.');
  }

  const allFiles = Array.isArray(files) && files.length > 0 ? files : (file ? [file] : []);
  if (allFiles.length === 0) {
    throw new Error('문제를 생성할 PDF 또는 이미지 파일을 선택해주세요.');
  }

  const firstFile = allFiles[0];
  const isPDF = firstFile.type === 'application/pdf' || firstFile.name.toLowerCase().endsWith('.pdf');
  const isImage = firstFile.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(firstFile.name);

  if (!isPDF && !isImage) {
    throw new Error('지원되지 않는 파일 형식입니다. PDF 또는 이미지 파일(.png, .jpg, .webp 등)만 업로드 가능합니다.');
  }

  // Construct prompt & parts payload for Gemini API
  const partsPayload = [];

  let promptText = `다음 업로드된 문서/이미지 내용을 바탕으로 5지선다 객관식 퀴즈 문제를 생성해주세요.\n\n`;
  if (subject) promptText += `- 과목/주제: ${subject}\n`;
  promptText += `- 생성할 문제 수: ${questionCount}개\n`;
  promptText += `- 난이도/대상: 초등학교 3~6학년 (업로드된 자료 내용과 난이도에 맞춰 3~6학년 수준에서 자동 조절)\n`;
  promptText += `- 보기 형태: 반드시 5지선다 (1번~5번 5개 보기)\n`;
  promptText += `- 정답 작성 주의사항: 정답 보기가 오답 보기보다 특별히 길거나 자세하지 않도록 5개 보기의 길이와 어조를 비슷하게 작성할 것!\n`;
  if (customPrompt) promptText += `- 추가 요청사항: ${customPrompt}\n`;

  if (isPDF) {
    const pdfData = await extractPDFContent(firstFile, selectedPages);
    if (pdfData.text) {
      promptText += `\n[문서 추출 텍스트 내용 (선택된 ${pdfData.processedPages.length}페이지)]:\n${pdfData.text.slice(0, 12000)}\n`;
    }
    partsPayload.push({ text: promptText });

    // Attach rendered PDF page images for vision support (up to 10 pages)
    if (pdfData.pageImages && pdfData.pageImages.length > 0) {
      for (const imgUrl of pdfData.pageImages.slice(0, 10)) {
        const base64Data = imgUrl.includes(',') ? imgUrl.split(',')[1] : imgUrl;
        partsPayload.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64Data
          }
        });
      }
    }
  } else if (isImage) {
    const imageFilesToProcess = allFiles.slice(0, 10);
    promptText += `\n(총 ${imageFilesToProcess.length}장의 이미지 파일 첨부됨)\n`;
    partsPayload.push({ text: promptText });

    for (const imgFile of imageFilesToProcess) {
      const imageDataUrl = await readFileAsDataURL(imgFile);
      const mimeType = imgFile.type || 'image/jpeg';
      const base64Data = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
      partsPayload.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data
        }
      });
    }
  }

  const systemPrompt = `You are an educational quiz generation AI for primary school teachers (elementary school grades 3 to 6).
Your task is to create high-quality, clear 5-option multiple-choice questions (5지선다) in Korean based on the provided material.

CRITICAL REQUIREMENTS:
1. Return strictly valid JSON with no extra commentary or markdown formatting outside the JSON object.
2. Structure format:
{
  "title": "과목/교재명 기반의 문제 은행 제목",
  "subject": "과목명",
  "questions": [
    {
      "question_num": "1",
      "question_text": "문제 질문 내용",
      "options": ["보기 1", "보기 2", "보기 3", "보기 4", "보기 5"],
      "answers": ["2"]
    }
  ]
}
3. Each question MUST have EXACTLY 5 choices in the 'options' array.
4. 'answers' MUST be an array containing a single string representing the 1-based index of the correct choice (e.g. ["1"], ["2"], ["3"], ["4"], or ["5"]).
5. IMPORTANT: Do NOT make the correct answer noticeably longer, more detailed, or structured differently than false options. All 5 choices MUST be similar in length, structure, and tone so that students cannot infer the correct answer by option length.
6. Target audience: Elementary school 3rd to 6th grade (초등학교 3~6학년). Automatically calibrate question difficulty within 3rd to 6th grade based on the uploaded content.
7. Generate exactly ${questionCount} questions.`;

  const targetModel = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(keyToUse)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: partsPayload
        }
      ],
      systemInstruction: {
        parts: [
          { text: systemPrompt }
        ]
      },
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const msg = errJson.error?.message || response.statusText || 'Gemini API 호출 실패';
    throw new Error(`Gemini API 오류 (${response.status}): ${msg}`);
  }

  const resData = await response.json();
  const rawContent = resData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawContent) {
    throw new Error('AI 응답이 비어있습니다.');
  }

  try {
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith('```json')) {
      cleanJsonStr = cleanJsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJsonStr.startsWith('```')) {
      cleanJsonStr = cleanJsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    const parsed = JSON.parse(cleanJsonStr);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('AI 응답 데이터 형식이 올바르지 않습니다.');
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse AI output:', rawContent, err);
    throw new Error('AI 문제 데이터 해석에 실패했습니다: ' + err.message);
  }
}
