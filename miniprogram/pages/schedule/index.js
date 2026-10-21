const store = require('../../utils/storage');
const schedule = require('../../utils/schedule');
const { attempt } = require('../../utils/ui');
const exams = require('../../utils/exams');
const appearance = require('../../utils/appearance');
const WEEKDAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
require('../../utils/page-sync').definePage({
  data: {
    term: schedule.empty(), week: 1, weekOptions: [], weekIndex: 0, weekStatus: '', days: [],
    courseDialog: '', courseDetails: [], courseTemporary: false, courseBusy: false, courseAction: '', courseError: '',
    weekRange: '', headerMonth: '', isCurrentWeek: false, scrollTarget: '',
    activeSection: 'courses', examDraft: {}, examFormVisible: false, examDetail: null, examBusy: false, examError: '', examMethods: exams.METHODS,
    examFilter: 0, examFilters: ['全部考试', '待考 / 进行中', '已结束'], examList: [], nextExam: null,
    todayCourseCount: 0, currentWeekText: '未设置', upcomingExamCount: 0, todayCourses: [],
    periods: Array.from({ length: 14 }, (_, i) => ({ number: i + 1, top: i * 96 })),
    thisWeek: [], panel: '', weekdays: WEEKDAYS, sections: Array.from({ length: 14 }, (_, i) => String(i + 1)),
    termBusy: false, termError: '', termName: '', termStart: '', totalWeeks: '20', draft: {}, weekSetupMode: 'date', currentWeekInput: '', calibrationPreview: '',
    importBusy: false, importError: '', importText: '', preview: [], previewCount: 0, previewSource: '', previewTerm: '', previewTimes: 0,
    boardHeight: 1344, importMode: 0, modes: ['追加（自动去重）', '替换全部课程']
  },
  onLoad(options) { this._searchOptions = options || {}; },
  addHomework(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.id || this.data.draft.id;
    if (id) wx.navigateTo({ url: '/pages/life/index?type=homework&courseId=' + encodeURIComponent(id) });
  },
  openHomework() { wx.navigateTo({ url: '/pages/life/index?type=homework' }); },
  onShow() {
    appearance.apply(this);
    if (!this.data.courseDialog) this._weekChosen = false; this.refresh();
    if (this._searchOptions) {
      const options = this._searchOptions; this._searchOptions = null;
      if (options.section === 'exams') { this.setData({ activeSection: 'exams' }); if (options.id) this.editExam({ currentTarget: { dataset: { id: options.id } } }); }
      else if (options.id) this.editById(options.id);
    }
    if (this.data.activeSection === 'courses' && this.data.term.courses.length && !this.data.term.termStart && !this.data.panel && !this.data.courseDialog) this.openSettings();
    clearInterval(this._examTimer);
    this._examTimer = setInterval(() => { if (this.data.activeSection === 'exams') this.refresh(); }, 60000);
  },
  onHide() { this.onWeekTouchCancel(); clearInterval(this._examTimer); },
  onUnload() { this.onWeekTouchCancel(); clearInterval(this._examTimer); },
  refresh() {
    return attempt(async () => {
      const term = store.read().schedule;
      const today = store.dateText(Date.now());
      let current = 0;
      let week = Math.min(this.data.week, term.totalWeeks), weekStatus = '';
      if (term.termStart) {
        current = schedule.currentWeek(term.termStart, today);
        if (!this._weekChosen) week = Math.max(1, Math.min(current, term.totalWeeks));
        weekStatus = current < 1 ? '尚未到第一周' : current > term.totalWeeks ? '已超出本学期周数' : '当前是第 ' + current + ' 周';
      } else weekStatus = '先在学期设置中填写第一周周一';
      const dates = schedule.weekDates(term.termStart, week, today);
      const days = schedule.board(term.courses, week).map((day, index) => Object.assign({}, day, dates[index] || { dateText: '', isToday: false }));
      const weekRange = dates.length ? dates[0].fullDate.replace(/-/g, '.') + ' — ' + dates[6].fullDate.replace(/-/g, '.') : '设置开学日期后显示每日日期';
      const thisWeek = term.courses.filter(c => c.weeks.includes(week)).sort((a, b) => a.day - b.day || a.start - b.start).map(c => Object.assign({}, c, {
        weekdayText: WEEKDAYS[c.day - 1], weeksText: c.weeks.join(',')
      }));
      const count = Math.max(term.periodTimes.length || 14, ...term.courses.map(c => c.end));
      const periods = Array.from({ length: count }, (_, index) => ({ number: index + 1, top: index * 96,
        start: term.periodTimes[index] ? term.periodTimes[index].start : '', end: term.periodTimes[index] ? term.periodTimes[index].end : '' }));
      days.forEach(day => { day.slots = periods.map(period => Object.assign({}, period, {
        occupied: day.blocks.some(block => period.number >= block.start && period.number <= block.end)
      })); });
      this.setData({ term, week, weekIndex: week - 1, weekStatus, thisWeek, periods, boardHeight: count * 96,
        days, weekRange, headerMonth: dates.length ? dates[0].month : '', isCurrentWeek: current === week,
        weekOptions: Array.from({ length: term.totalWeeks }, (_, i) => '第 ' + (i + 1) + ' 周') });
      const now = Date.now();
      const allExams = term.exams.map(exam => exams.describe(exam, now));
      if (this.data.examDetail) this.setData({ examDetail: allExams.find(exam => exam.id === this.data.examDetail.id) || null });
      const upcoming = allExams.filter(exam => exam.status !== 'finished').sort((a, b) => a.startAt - b.startAt);
      const finished = allExams.filter(exam => exam.status === 'finished').sort((a, b) => b.startAt - a.startAt);
      const currentDay = (new Date(now).getDay() + 6) % 7 + 1;
      const todayCourses = current >= 1 && current <= term.totalWeeks ? term.courses.filter(c => c.day === currentDay && c.weeks.includes(current)).sort((a, b) => a.start - b.start) : [];
      this.setData({ examList: this.data.examFilter === 1 ? upcoming : this.data.examFilter === 2 ? finished : upcoming.concat(finished),
        nextExam: upcoming[0] || null, upcomingExamCount: upcoming.length, todayCourseCount: todayCourses.length, todayCourses,
        currentWeekText: !term.termStart ? '未设置' : current < 1 ? '未开学' : current > term.totalWeeks ? '已结束' : '第 ' + current + ' 周' });
    });
  },
  changeWeek(e) { this._weekChosen = true; this.setData({ week: Number(e.detail.value) + 1 }); this.refresh(); },
  switchSection(e) {
    if (this.data.courseBusy || this.data.termBusy || this.data.examBusy || this.data.importBusy) return;
    this.closeCourseDialog();
    this.onWeekTouchCancel();
    const section = e.currentTarget.dataset.section;
    if (!['courses', 'exams'].includes(section)) return;
    this.setData({ activeSection: section, panel: '', examFormVisible: false, examDetail: null,
      scrollTarget: this.data.scrollTarget === 'section-top-a' ? 'section-top-b' : 'section-top-a' });
    this.refresh();
  },
  onExamFilter(e) { this.setData({ examFilter: Number(e.detail.value) }); this.refresh(); },
  addExam() {
    if (this.data.examBusy || this.data.importBusy) return;
    this.setData({ examFormVisible: true, examDetail: null, examError: '', examDraft: { id: '', title: '', date: store.dateText(Date.now()),
      start: '09:00', end: '11:00', location: '', seat: '', method: exams.METHODS[0], methodIndex: 0, note: '' } });
  },
  openExamDetail(e) {
    if (this.data.examBusy || this.data.importBusy) return;
    const exam = this.data.term.exams.find(item => item.id === e.currentTarget.dataset.id);
    if (exam) this.setData({ examDetail: exams.describe(exam, Date.now()), examFormVisible: false });
  },
  closeExamDetail() { if (!this.data.examBusy) this.setData({ examDetail: null }); },
  editExam(e) {
    if (this.data.examBusy || this.data.importBusy) return;
    const exam = this.data.term.exams.find(item => item.id === e.currentTarget.dataset.id);
    if (exam) this.setData({ examFormVisible: true, examDetail: null, examError: '', examDraft: Object.assign({}, exam, { methodIndex: exams.METHODS.indexOf(exam.method) }) });
  },
  onExamField(e) {
    if (this.data.examBusy) return;
    const key = e.currentTarget.dataset.key;
    if (!['title', 'date', 'start', 'end', 'location', 'seat', 'methodIndex', 'note'].includes(key)) return;
    const patch = { [key]: e.detail.value };
    if (key === 'methodIndex') { patch.methodIndex = Number(e.detail.value); patch.method = exams.METHODS[patch.methodIndex]; }
    this.setData({ examDraft: Object.assign({}, this.data.examDraft, patch), examError: '' });
  },
  closeExamForm() { if (!this.data.examBusy) this.setData({ examFormVisible: false, examError: '' }); },
  async saveExam() {
    if (this.data.examBusy || !this.data.examFormVisible) return;
    this.setData({ examBusy: true, examError: '' });
    try {
      await store.saveExam(this.data.examDraft);
      this.setData({ examFormVisible: false }); await this.refresh();
      wx.showToast({ title: '考试已保存', icon: 'success' });
    } catch (error) { this.setData({ examError: error.message || '保存未完成，请重试' }); }
    finally { this.setData({ examBusy: false }); }
  },
  deleteExam() {
    const id = this.data.examDraft.id;
    if (!id || this.data.examBusy) return;
    this.setData({ examBusy: true, examError: '' });
    wx.showModal({ title: '删除考试安排', content: '确认删除这场考试？', confirmColor: '#aa5849',
      fail: () => this.setData({ examBusy: false }),
      success: async res => {
        if (!res.confirm) { this.setData({ examBusy: false }); return; }
        try { await store.removeExam(id); this.setData({ examFormVisible: false }); await this.refresh(); }
        catch (error) { this.setData({ examError: error.message || '删除未完成，请重试' }); }
        finally { this.setData({ examBusy: false }); }
      }
    });
  },
  viewTodayCourse(e) {
    this.switchSection({ currentTarget: { dataset: { section: 'courses' } } });
    this.viewCourse(e);
  },
  // 只识别课表上的单指横向手势；竖向滚动一旦开始，不再中途改判为切周。
  onWeekTouchStart(e) {
    this._weekGesture = null;
    if (this.data.activeSection !== 'courses' || this.data.panel || this.data.courseDialog || !this.data.term.termStart || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    this._weekGesture = { x: touch.clientX, y: touch.clientY, id: touch.identifier, axis: '', startedAt: Date.now() };
  },
  onWeekTouchMove(e) {
    const gesture = this._weekGesture;
    if (!gesture) return;
    if (!e.touches || e.touches.length !== 1 || e.touches[0].identifier !== gesture.id) { this.onWeekTouchCancel(); return; }
    const dx = Math.abs(e.touches[0].clientX - gesture.x), dy = Math.abs(e.touches[0].clientY - gesture.y);
    if (!gesture.axis && Math.max(dx, dy) >= 12) {
      if (dy > dx * 1.2) gesture.axis = 'vertical';
      else if (dx > dy * 1.5) gesture.axis = 'horizontal';
    }
  },
  onWeekTouchEnd(e) {
    const gesture = this._weekGesture;
    this._weekGesture = null;
    if (!gesture || gesture.axis === 'vertical' || this.data.activeSection !== 'courses' || this.data.panel || this.data.courseDialog || !this.data.term.termStart || Date.now() - gesture.startedAt > 800) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch || touch.identifier !== gesture.id || (e.touches && e.touches.length)) return;
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this._suppressCourseTapUntil = Date.now() + 300;
    if (dx < 0) this.nextWeek(); else this.previousWeek();
  },
  onWeekTouchCancel() { this._weekGesture = null; },
  previousWeek() { if (this.data.week > 1) { this._weekChosen = true; this.setData({ week: this.data.week - 1 }); this.refresh(); } },
  nextWeek() { if (this.data.week < this.data.term.totalWeeks) { this._weekChosen = true; this.setData({ week: this.data.week + 1 }); this.refresh(); } },
  currentWeek() {
    if (!this.data.term.termStart) { this.openSettings(); return; }
    this._weekChosen = false; this.refresh();
    this.setData({ scrollTarget: this.data.scrollTarget === 'week-top-a' ? 'week-top-b' : 'week-top-a' });
  },
  closePanel() { if (this.data.importBusy) return; if (this.data.panel === 'settings') return this.closeSettings(); this.setData({ panel: '', importError: '' }); },
  openSettings() {
    if (this.data.termBusy || this.data.courseBusy || this.data.courseDialog || this.data.importBusy || this.data.examBusy) return;
    this.onWeekTouchCancel();
    const term = this.data.term;
    const current = term.termStart ? schedule.currentWeek(term.termStart, store.dateText(Date.now())) : 0;
    this.setData({ panel: 'settings', termError: '', termName: term.termName, termStart: term.termStart,
      totalWeeks: String(term.totalWeeks), weekSetupMode: term.termStart ? 'date' : 'week',
      currentWeekInput: current >= 1 && current <= term.totalWeeks ? String(current) : '', calibrationPreview: '' });
    this.updateCalibrationPreview();
  },
  closeSettings() {
    if (this.data.termBusy) return;
    this.setData({ panel: '', termError: '' });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  onSetupMode(e) {
    if (this.data.termBusy) return;
    const mode = e.currentTarget.dataset.mode;
    if (['date', 'week'].includes(mode)) this.setData({ weekSetupMode: mode, termError: '' });
  },
  updateCalibrationPreview() {
    let preview = '';
    try { preview = schedule.termStartForWeek(store.dateText(Date.now()), this.data.currentWeekInput, Number(this.data.totalWeeks)); }
    catch (error) { /* 未填完时不显示推算结果，保存时再明确校验。 */ }
    this.setData({ calibrationPreview: preview });
  },
  onSetting(e) {
    if (this.data.termBusy) return;
    const key = e.currentTarget.dataset.key;
    if (['termName', 'termStart', 'totalWeeks', 'currentWeekInput'].includes(key)) {
      this.setData({ [key]: e.detail.value, termError: '' }); this.updateCalibrationPreview();
    }
  },
  async saveSettings() {
    if (this.data.termBusy || this.data.panel !== 'settings') return;
    this.setData({ termBusy: true, termError: '' });
    try {
      const totalWeeks = Number(this.data.totalWeeks);
      const termStart = this.data.weekSetupMode === 'week' ? schedule.termStartForWeek(store.dateText(Date.now()), this.data.currentWeekInput, totalWeeks) : this.data.termStart;
      if (!termStart) throw new Error('请选择第一周的周一，或改用“当前第几周”校准');
      await store.saveTerm({ termName: this.data.termName, termStart, totalWeeks });
      this._weekChosen = false; this.setData({ termBusy: false }); this.closeSettings(); await this.refresh();
      this.setData({ scrollTarget: this.data.scrollTarget === 'week-top-a' ? 'week-top-b' : 'week-top-a' });
      wx.showToast({ title: '已定位本周', icon: 'success' });
    } catch (error) { this.setData({ termError: error.message || '保存未完成，请重试' }); }
    finally { this.setData({ termBusy: false }); }
  },
  addCourse() {
    if (this.data.courseBusy) return;
    this.onWeekTouchCancel();
    this.setData({ panel: '', courseDialog: 'edit', courseTemporary: false, courseDetails: [], courseError: '',
      draft: { id: '', title: '', teacher: '', location: '', day: 1, start: 1, end: 2, weeks: '1-' + this.data.term.totalWeeks } });
  },
  openEmptySlot(e) {
    if (Date.now() < (this._suppressCourseTapUntil || 0) || this.data.courseBusy || this.data.courseDialog || this.data.panel || this.data.activeSection !== 'courses' || !this.data.term.termStart) return;
    const day = Number(e.currentTarget.dataset.day), period = Number(e.currentTarget.dataset.period);
    if (!Number.isInteger(day) || day < 1 || day > 7 || !Number.isInteger(period) || period < 1 || period > this.data.sections.length) return;
    const occupied = this.data.term.courses.filter(course => course.day === day && course.weeks.includes(this.data.week) && course.start <= period && course.end >= period);
    if (occupied.length) return this.showCourseDetails(occupied.map(course => course.id));
    this.onWeekTouchCancel();
    this.setData({ courseDialog: 'edit', courseTemporary: true, courseDetails: [], courseError: '',
      draft: { id: '', title: '', teacher: '', location: '', day, start: period, end: period, weeks: String(this.data.week) } });
  },
  viewCourse(e) { this.showCourseDetails([e.currentTarget.dataset.id]); },
  showCourseDetails(ids) {
    if (this.data.courseBusy) return;
    const term = this.data.term;
    const details = term.courses.filter(course => ids.includes(course.id)).map(course => {
      const start = term.periodTimes[course.start - 1], end = term.periodTimes[course.end - 1];
      const day = this.data.days.find(day => day.day === course.day);
      return Object.assign({}, course, { weekdayText: WEEKDAYS[course.day - 1], dateText: day && day.fullDate || '',
        weeksText: course.weeks.join('、'), timeText: start && end ? start.start + ' — ' + end.end : '未设置作息时间' });
    });
    if (!details.length) return;
    this.onWeekTouchCancel();
    this.setData({ panel: '', courseDialog: 'details', courseDetails: details, courseTemporary: false, courseError: '', draft: { id: '' } });
  },
  editCourse(e) { this.editById(e.currentTarget.dataset.id); },
  editById(id) {
    if (this.data.courseBusy) return;
    const course = this.data.term.courses.find(course => course.id === id);
    if (!course) return;
    this.onWeekTouchCancel();
    // 编辑标记由 page-sync 在进入此方法时建立，不能在这里用 panel:'' 提前清除。
    this.setData({ courseDialog: 'edit', courseTemporary: false, courseError: '',
      draft: Object.assign({}, course, { weeks: course.weeks.join(',') }) });
  },
  openBlock(e) {
    if (Date.now() < (this._suppressCourseTapUntil || 0) || this.data.courseDialog) return;
    const day = this.data.days.find(day => day.day === Number(e.currentTarget.dataset.day));
    const block = day && day.blocks.find(block => block.key === e.currentTarget.dataset.key);
    if (block) this.showCourseDetails(block.courses.map(course => course.id));
  },
  closeCourseDialog() {
    if (this.data.courseBusy || !this.data.courseDialog) return;
    this.setData({ courseDialog: '', courseDetails: [], courseError: '', courseTemporary: false, draft: { id: '' } });
    if (wx.hideKeyboard) wx.hideKeyboard();
  },
  preventCourseTouch() {},
  onCourseField(e) {
    if (this.data.courseBusy) return;
    const key = e.currentTarget.dataset.key;
    if (!['title', 'teacher', 'location', 'weeks', 'day', 'start', 'end'].includes(key)) return;
    const value = ['day', 'start', 'end'].includes(key) ? Number(e.detail.value) + 1 : e.detail.value;
    this.setData({ draft: Object.assign({}, this.data.draft, { [key]: value }), courseError: '' });
  },
  async saveCourse() {
    if (this.data.courseBusy || this.data.courseDialog !== 'edit') return;
    this.setData({ courseBusy: true, courseAction: 'save', courseError: '' });
    try {
      await store.saveCourse(this.data.draft);
      this.setData({ courseBusy: false, courseAction: '' });
      this.closeCourseDialog(); await this.refresh();
      wx.showToast({ title: '课程已保存', icon: 'success' });
    } catch (error) {
      this.setData({ courseError: error.message || '保存未完成，请重试' });
    } finally { this.setData({ courseBusy: false, courseAction: '' }); }
  },
  deleteCourse() {
    const id = this.data.draft.id;
    if (!id || this.data.courseBusy || this.data.courseDialog !== 'edit') return;
    this.setData({ courseBusy: true, courseAction: 'delete', courseError: '' });
    wx.showModal({ title: '删除课程', content: '删除此课程的全部上课周次？', confirmColor: '#aa5849',
      fail: () => this.setData({ courseBusy: false, courseAction: '' }),
      success: async result => {
        if (!result.confirm) { this.setData({ courseBusy: false, courseAction: '' }); return; }
        try {
          await store.removeCourse(id);
          this.setData({ courseBusy: false, courseAction: '' });
          this.closeCourseDialog(); await this.refresh();
          wx.showToast({ title: '课程已删除', icon: 'success' });
        } catch (error) { this.setData({ courseError: error.message || '删除未完成，请重试' }); }
        finally { this.setData({ courseBusy: false, courseAction: '' }); }
      }
    });
  },
  openImport() {
    if (this.data.importBusy || this.data.courseBusy || this.data.termBusy || this.data.examBusy) return;
    this.onWeekTouchCancel();
    this.setData({ panel: 'import', importError: '', examDetail: null, examFormVisible: false,
      preview: [], previewCount: 0, previewSource: '', previewTerm: '', previewTimes: 0 });
  },
  onImportText(e) {
    if (this.data.importBusy) return;
    this.setData({ importText: e.detail.value, importError: '', preview: [], previewCount: 0, previewSource: '', previewTerm: '', previewTimes: 0 });
  },
  onImportMode(e) { if (!this.data.importBusy) this.setData({ importMode: Number(e.detail.value) }); },
  chooseFile() {
    if (this.data.importBusy) return;
    if (!wx.chooseMessageFile) { this.setData({ importError: '请在手机微信中选择文件，当前环境可使用文本导入。' }); return; }
    this.setData({ importBusy: true, importError: '' });
    const failed = message => this.setData({ importBusy: false, importError: message });
    try {
      wx.chooseMessageFile({ count: 1, type: 'file', extension: ['doc', 'html', 'htm', 'mht', 'mhtml', 'csv', 'json', 'txt'],
        success: res => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file || file.size > 1024 * 1024) return failed('请选择 1MB 以内的文件');
          try {
            wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8',
              success: result => { this.setData({ importText: result.data, importBusy: false }); this.previewImport(); },
              fail: () => failed('文件读取失败，请使用学校原始导出的网页型 DOC，或 UTF-8 的 CSV/JSON 文件。') });
          } catch (error) { failed('文件读取失败，请重新选择文件'); }
        },
        fail: error => failed(/cancel/i.test(error.errMsg || '') ? '' : '未能选择文件，请重试') });
    } catch (error) { failed('未能选择文件，请重试'); }
  },
  previewImport() {
    if (this.data.importBusy) return;
    try {
      this.setData({ importError: '', preview: [], previewCount: 0, previewSource: '', previewTerm: '', previewTimes: 0 });
      const report = schedule.parseDocument(this.data.importText, this.data.term.totalWeeks);
      this.setData({ preview: report.courses.map((c, index) => ({ key: index, title: c.title,
        description: WEEKDAYS[c.day - 1] + ' · 第' + c.start + '-' + c.end + '节 · ' + c.weeks.join(',') + '周', location: c.location })),
        previewCount: report.courses.length, previewSource: report.source, previewTerm: report.termName, previewTimes: report.periodTimes.length });
    } catch (error) { this.setData({ importError: error.message || '课表解析失败，请检查文本' }); }
  },
  confirmImport() {
    if (this.data.importBusy || !this.data.previewCount) return;
    const mode = this.data.importMode === 0 ? 'append' : 'replace';
    this.setData({ importBusy: true, importError: '' });
    wx.showModal({ title: mode === 'replace' ? '替换全部课程？' : '确认导入课表',
      content: mode === 'replace' ? '现有课程将被替换，开学日期、待办和记账保留。建议先导出备份。' : '将追加 ' + this.data.previewCount + ' 条上课安排，重复项自动跳过。',
      fail: () => this.setData({ importBusy: false }),
      success: async result => {
        if (!result.confirm) { this.setData({ importBusy: false }); return; }
        try {
          // 提交时重新解析，确认结果始终对应当前草稿。
          const report = schedule.parseDocument(this.data.importText, this.data.term.totalWeeks);
          await store.importCourses(report.courses, mode, report);
          this._weekChosen = false;
          this.setData({ panel: '', importBusy: false, importText: '', preview: [], previewCount: 0 });
          await this.refresh();
          if (!this.data.term.termStart) {
            this.openSettings(); wx.showToast({ title: '已导入，请校准当前周', icon: 'none' });
          } else wx.showToast({ title: '课表已导入', icon: 'success' });
        } catch (error) { this.setData({ importError: error.message || '导入未完成，请重试' }); }
        finally { this.setData({ importBusy: false }); }
      }
    });
  },
  copyTemplate() {
    wx.setClipboardData({ data: '课程名称,星期,开始节次,结束节次,周次,教师,教室\n示例课程（请替换）,星期一,1,2,1-16周,教师姓名,教室' });
  }
});
