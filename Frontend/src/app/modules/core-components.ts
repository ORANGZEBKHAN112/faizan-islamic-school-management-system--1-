import { Component, OnInit } from '@angular/core';
import { StudentService, FeeService, ExamService } from '../../core/services/core.services';
import { DashboardStats } from '../../shared/models';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  stats: DashboardStats = {
    studentCount: 0,
    campusCount: 0,
    outstandingFees: 0,
    quickPayCollections: 0,
    examStats: { totalExams: 0, pendingResults: 0 }
  };

  constructor(
    private studentService: StudentService,
    private feeService: FeeService,
    private examService: ExamService
  ) { }

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    // Load stats from API
  }
}

@Component({
  selector: 'app-student-list',
  templateUrl: './student-list.component.html',
  styleUrls: ['./student-list.component.scss']
})
export class StudentListComponent implements OnInit {
  students: any[] = [];
  searchTerm: string = '';

  constructor(private studentService: StudentService) { }

  ngOnInit(): void {
    this.loadStudents();
  }

  loadStudents(): void {
    this.studentService.getStudents().subscribe(data => {
      this.students = data;
    });
  }

  deleteStudent(id: number): void {
    if (confirm('Are you sure you want to delete this student?')) {
      this.studentService.deleteStudent(id).subscribe(() => {
        this.loadStudents();
      });
    }
  }
}
