import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Student, FeeVoucher, ExamTerm, ResultCard, Staff, QuickPayConfig } from '../shared/models';

@Injectable({
  providedIn: 'root'
})
export class StudentService {
  private apiUrl = `${environment.apiUrl}/students`;

  constructor(private http: HttpClient) { }

  getStudents(): Observable<Student[]> {
    return this.http.get<Student[]>(this.apiUrl);
  }

  getStudentById(id: number): Observable<Student> {
    return this.http.get<Student>(`${this.apiUrl}/${id}`);
  }

  addStudent(student: any): Observable<Student> {
    return this.http.post<Student>(this.apiUrl, student);
  }

  updateStudent(id: number, student: any): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/${id}`, student);
  }

  deleteStudent(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getDefaulters(): Observable<Student[]> {
    return this.http.get<Student[]>(`${this.apiUrl}/defaulters`);
  }
}

@Injectable({
  providedIn: 'root'
})
export class FeeService {
  private apiUrl = `${environment.apiUrl}/fees`;

  constructor(private http: HttpClient) { }

  generateBulkVouchers(month: number, year: number, campusId?: number): Observable<any> {
    let params = new HttpParams().set('month', month).set('year', year);
    if (campusId) params = params.set('campusId', campusId);
    return this.http.post(`${this.apiUrl}/generate-bulk`, {}, { params });
  }

  generateSingleVoucher(studentId: number, month: number, year: number): Observable<FeeVoucher> {
    const params = new HttpParams().set('month', month).set('year', year);
    return this.http.post<FeeVoucher>(`${this.apiUrl}/generate-single/${studentId}`, {}, { params });
  }

  getQuickPayConfig(): Observable<QuickPayConfig> {
    return this.http.get<QuickPayConfig>(`${this.apiUrl}/quickpay/config`);
  }

  updateQuickPayConfig(config: QuickPayConfig): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/quickpay/config`, config);
  }
}

@Injectable({
  providedIn: 'root'
})
export class ExamService {
  private apiUrl = `${environment.apiUrl}/exams`;

  constructor(private http: HttpClient) { }

  getExamTerms(campusId: number): Observable<ExamTerm[]> {
    return this.http.get<ExamTerm[]>(`${this.apiUrl}/terms/${campusId}`);
  }

  addMarks(marks: any[]): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/marks`, marks);
  }

  getResultCard(studentId: number, examTermId: number): Observable<ResultCard> {
    return this.http.get<ResultCard>(`${this.apiUrl}/result-card/${studentId}/${examTermId}`);
  }
}
