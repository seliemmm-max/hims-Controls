/* ========================================
   js/normalSystem.js
   منطق النظام العادي + قاعدة H + الموافقة
   ======================================== */

let normalRowsRaw = [];
let approvalSet   = new Set();
let beneficiaries = [];

/**
 * تهيئة أحداث النظام العادي
 */
function initNormalSystem() {

    // ── رفع ملف الطلاب → مسح تلقائي ثم قراءة ──
    document.getElementById('normalInput')?.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        clearProcessedData();                          // ← مسح البيانات القديمة
        normalRowsRaw = await readExcel(e.target.files[0]);
        document.getElementById('normalMsg').innerHTML =
            `<div class="alert-info">✅ تم رفع ${normalRowsRaw.length} صف - تم مسح البيانات السابقة تلقائياً</div>`;
    });

    // ── رفع ملف الموافقة → مسح تلقائي ثم قراءة ──
    document.getElementById('approvalInput')?.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        clearProcessedData();                          // ← مسح البيانات القديمة
        const rows = await readExcel(e.target.files[0]);
        approvalSet.clear();
        for (const row of rows)
            for (const cell of row) {
                const c = parseInt(cell);
                if (!isNaN(c)) approvalSet.add(c);
            }
        document.getElementById('normalMsg').innerHTML +=
            `<div class="alert-info">📋 تم تحميل ${approvalSet.size} كود موافقة - تم مسح البيانات السابقة</div>`;
    });

    // ── زر تطبيق النظام العادي ──
    document.getElementById('processNormalBtn')?.addEventListener('click', processNormal);
}

/**
 * تطبيق النظام العادي على الصفوف المرفوعة
 */
async function processNormal() {
    syncNormalFromUI('normalTab');
    if (!normalRowsRaw.length) { alert('يرجى رفع ملف الطلاب'); return; }

    // -- تحديد أعمدة الرأس --
    const header = normalRowsRaw[0];
    let idxCode = -1, idxName = -1, idxMid = -1, idxAct = -1, idxFinal = -1;
    for (let i = 0; i < header.length; i++) {
        const c = String(header[i] || "").trim().toLowerCase();
        if (c.includes('كود') || c === 'code' || c.includes('رقم')) idxCode  = i;
        if (c.includes('اسم') || c.includes('name'))                idxName  = i;
        if (c.includes('ميد') || c.includes('mid'))                 idxMid   = i;
        if (c.includes('اعمال') || c.includes('أعمال') ||
            c.includes('عمال')  || c.includes('act'))               idxAct   = i;
        if (c.includes('فاينل') || c.includes('final') ||
            c.includes('نهائي') || c.includes('final'))             idxFinal = i;
    }
    if (idxCode  === -1) idxCode  = 0;
    if (idxMid   === -1) idxMid   = 2;
    if (idxAct   === -1) idxAct   = 3;
    if (idxFinal === -1) idxFinal = 4;

    // ── تشخيص الأعمدة في وضع dev ──
    console.log('🔍 أعمدة الهيدر المكتشفة:', { idxCode, idxName, idxMid, idxAct, idxFinal });
    console.log('🔍 الهيدر الأول:', header);

    const results = [], beforeRaise = [];
    beneficiaries = [];

    for (let i = 1; i < normalRowsRaw.length; i++) {
        const row = normalRowsRaw[i];
        const code = parseInt(row[idxCode]);
        if (isNaN(code)) continue;

        const name     = (idxName !== -1) ? row[idxName] : `طالب ${code}`;
        let   mid      = parseGrade(row[idxMid]);
        let   act      = parseGrade(row[idxAct]);
        let   finalOrig= parseGrade(row[idxFinal]);
        if (mid === null || act === null || finalOrig === null) continue;

        const oldMid = mid, oldAct = act;
        const isApproved = approvalSet.has(code);

        // ── معالجة طلاب الموافقة ──
        if (isApproved && finalOrig >= 0 && !isNaN(finalOrig)) {
            const newMid = 15 + (finalOrig / 50) * normalSettings.midFactor;
            const newAct = 20 + (finalOrig / 50) * normalSettings.actFactor;
            mid = Math.min(normalSettings.midMax, Math.max(normalSettings.midMin, newMid));
            act = Math.min(normalSettings.actMax, Math.max(normalSettings.actMin, newAct));
            beneficiaries.push({ code, name, oldMid, oldAct, newMid: mid, newAct: act });
        }

        // ── قاعدة H: لغير الموافقة وغير الغائبين ──
        let finalAct = act;
        if (normalSettings.applyHEnabled && !isApproved &&
            mid >= 0 && act >= 0 && finalOrig >= 0 && !isNaN(finalOrig)) {
           const variable = 10 - normalSettings.hValue;
           const added = act + normalSettings.hValue + (finalOrig / 50) * variable;
           
            finalAct = Math.ceil(added);
            if (finalAct > 30) finalAct = 30;
            if (finalAct < 0)  finalAct = 0;
        }

        const totalBefore = (mid < 0 || finalAct < 0 || finalOrig < 0)
            ? Math.min(mid, finalAct, finalOrig)
            : (mid + finalAct + finalOrig);

        beforeRaise.push({ code, name, mid, act: finalAct, finalOrig, totalBefore });

        const totalAfter = applyRaise(
            totalBefore,
            normalSettings.minRaise, normalSettings.maxRaise,
            normalSettings.passGrade, normalSettings.boostPoints,
            normalSettings.raiseType
        );

        results.push({ code, name, mid, act: finalAct, finalOriginal: finalOrig, finalComputed: totalAfter });
    }

    // -- حفظ وعرض --
    processedData      = results;
    currentSys         = 'normal';
    rawBeforeRaiseData = beforeRaise;

    if (!results.length) {
        document.getElementById('normalMsg').innerHTML = `
            <div class="alert-info" style="border-color:#c0392b; background:#ffeaea;">
                ⚠️ لم يتم العثور على بيانات صالحة!<br>
                <strong>تحقق من:</strong><br>
                • أن الصف الأول هو الهيدر (كود، اسم، ميد، أعمال، فاينل)<br>
                • أن الأكواد أرقام وليست فارغة<br>
                • أن الدرجات أرقام أو "غ" أو "إلغاء"<br>
                • ترتيب الأعمدة: كود | اسم | ميد | أعمال | فاينل
                <br><small style="color:#888">عدد الصفوف المرفوعة: ${normalRowsRaw.length - 1} صف بيانات</small>
            </div>`;
        return;
    }

    displayTable(results, 'normalTable');
    updateCompareStats(beforeRaise.map(s => s.totalBefore), results.map(s => s.finalComputed));

    // -- عرض المستفيدين --
    let benefHtml = '';
    if (beneficiaries.length) {
        benefHtml = `
            <div class="alert-info">
                <strong>المستفيدون من الموافقة (تم تعديل الميد/الأعمال)</strong>
                <div class="beneficiary-list">
                    <table>
                        <thead><tr><th>الكود</th><th>الاسم</th><th>ميد قديم</th><th>ميد جديد</th><th>أعمال قديم</th><th>أعمال جديد</th></tr></thead>
                        <tbody>
                            ${beneficiaries.map(b => `
                                <tr>
                                    <td>${b.code}</td><td>${b.name}</td>
                                    <td>${b.oldMid}</td><td>${b.newMid.toFixed(1)}</td>
                                    <td>${b.oldAct}</td><td>${b.newAct.toFixed(1)}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }
    document.getElementById('beneficiariesArea').innerHTML = benefHtml;

    document.getElementById('normalMsg').innerHTML = `
        <div class="alert-info">
            ✔ معالجة ${results.length} طالب -
            الرفع: ${normalSettings.raiseType === 'direct' ? 'مباشر' : 'تدريجي'} -
            قاعدة H: ${normalSettings.applyHEnabled ? `مطبقة (قيمة ${normalSettings.hValue})` : 'معطلة'}
        </div>`;

    setupPrintBeneficiaries('printNormalBeneficiariesBtn', 'beneficiariesArea');
    setupPrintTable('printNormalTableBtn', 'normalTable');
}
