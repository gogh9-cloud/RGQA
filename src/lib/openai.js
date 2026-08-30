import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker URL
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;

export function getOpenAIApiKey() {
  return localStorage.getItem('rgqa_openai_api_key') || import.meta.env.VITE_OPENAI_API_KEY || '';
}

export function saveOpenAIApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem('rgqa_openai_api_key', key.trim());
  } else {
    localStorage.removeItem('rgqa_openai_api_key');
  }
}

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
  questionCount = 5,
  difficulty = '초등학교 고학년(5~6학년)',
  customPrompt = '',
  model = 'gpt-4o-mini'
}) {
  const keyToUse = apiKey || getOpenAIApiKey();
  if (!keyToUse) {
    throw new Error('OpenAI API Key가 설정되지 않았습니다. API 키를 입력하거나 설정해주세요.');
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

  // Construct message content
  const contentPayload = [];

  let promptText = `다음 업로드된 문서/이미지 내용을 바탕으로 객관식 퀴즈 문제를 생성해주세요.\n\n`;
  if (subject) promptText += `- 과목/주제: ${subject}\n`;
  promptText += `- 생성할 문제 수: ${questionCount}개\n`;
  promptText += `- 난이도/대상: ${difficulty}\n`;
  if (customPrompt) promptText += `- 추가 요청사항: ${customPrompt}\n`;

  if (isPDF) {
    const pdfData = await extractPDFContent(firstFile, selectedPages);
    if (pdfData.text) {
      promptText += `\n[문서 추출 텍스트 내용 (선택된 ${pdfData.processedPages.length}페이지)]:\n${pdfData.text.slice(0, 12000)}\n`;
    }
    contentPayload.push({ type: 'text', text: promptText });

    // Attach rendered PDF page images for vision support (up to 10 pages)
    if (pdfData.pageImages && pdfData.pageImages.length > 0) {
      for (const imgUrl of pdfData.pageImages.slice(0, 10)) {
        contentPayload.push({
          type: 'image_url',
          image_url: { url: imgUrl, detail: 'low' }
        });
      }
    }
  } else if (isImage) {
    const imageFilesToProcess = allFiles.slice(0, 10);
    promptText += `\n(총 ${imageFilesToProcess.length}장의 이미지 파일 첨부됨)\n`;
    contentPayload.push({ type: 'text', text: promptText });

    for (const imgFile of imageFilesToProcess) {
      const imageDataUrl = await readFileAsDataURL(imgFile);
      contentPayload.push({
        type: 'image_url',
        image_url: { url: imageDataUrl, detail: 'high' }
      });
    }
  }

  const systemPrompt = `You are an educational quiz generation AI for primary and secondary school teachers.
Your task is to create high-quality, clear multiple-choice questions in Korean based on the provided material.

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
      "options": ["보기 1", "보기 2", "보기 3", "보기 4"],
      "answers": ["2"]
    }
  ]
}
3. Each question MUST have exactly 4 choices in the 'options' array.
4. 'answers' MUST be an array containing a single string representing the 1-based index of the correct choice (e.g. ["1"], ["2"], ["3"], or ["4"]).
5. Provide accurate questions suitable for the requested grade level.
6. Generate exactly ${questionCount} questions.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keyToUse}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contentPayload }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const msg = errJson.error?.message || response.statusText || 'API 호출 실패';
    throw new Error(`OpenAI API 오류 (${response.status}): ${msg}`);
  }

  const resData = await response.json();
  const rawContent = resData.choices[0]?.message?.content;

  if (!rawContent) {
    throw new Error('AI 응답이 비어있습니다.');
  }

  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('AI 응답 데이터 형식이 올바르지 않습니다.');
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse AI output:', rawContent, err);
    throw new Error('AI 문제 데이터 해석에 실패했습니다: ' + err.message);
  }
}
